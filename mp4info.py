#!/usr/bin/env python3
"""
mp4info.py — 외부 라이브러리 없이 MP4(ISOBMFF) 파일을 직접 파싱해서 정보를 출력한다.

지원 범위
  - 박스 트리 파싱: 64bit largesize, size=0(파일 끝까지), uuid, FullBox
  - ftyp 브랜드, mvhd / tkhd / mdhd / hdlr
  - 코덱 상세: H.264(avcC), HEVC(hvcC), AV1(av1C), VP9(vpcC), AAC/MP3(esds), Opus(dOps)
  - 샘플 테이블(stts/stsz/stss/ctts/stco) → 프레임레이트, 비트레이트, 키프레임 수
  - Fragmented MP4(moof/traf/trun) 집계
  - 메타데이터: iTunes 스타일(ilst), QuickTime mdta(keys), udta © 텍스트
  - mov, m4a, 3gp, heic 등 ISOBMFF 계열도 대부분 읽을 수 있음

사용법
  python3 mp4info.py video.mp4             요약 정보
  python3 mp4info.py video.mp4 --tree      박스 트리도 출력
  python3 mp4info.py video.mp4 --json      JSON으로 출력
  python3 mp4info.py *.mp4                 여러 파일
"""

from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
import os
import struct
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

# ═══════════════════════════════════════════════════════════════════════════
# 1. 박스 트리 파싱
# ═══════════════════════════════════════════════════════════════════════════

# 페이로드가 곧 자식 박스들인 순수 컨테이너
CONTAINERS = {
    "moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta",
    "mvex", "moof", "traf", "mfra", "sinf", "schi", "tref", "ilst",
    "gmhd", "wave",
}
# 비디오 / 오디오 샘플 엔트리 (stsd 안). 고정 필드 뒤에 자식 박스(avcC, esds …)가 온다
VISUAL_ENTRIES = {
    "avc1", "avc3", "hvc1", "hev1", "dvh1", "dvhe", "dva1", "dvav", "av01",
    "vp08", "vp09", "mp4v", "encv", "jpeg", "mjpa",
    "apch", "apcn", "apcs", "apco", "ap4h",
}
AUDIO_ENTRIES = {
    "mp4a", "enca", "ac-3", "ec-3", "Opus", "fLaC", "alac", "mp3 ", ".mp3",
    "ipcm", "lpcm", "sowt", "twos",
}
# 최상위에서 내용을 읽지 않는 박스 (대용량 미디어 데이터 / 패딩)
SKIP_PAYLOAD = {"mdat", "free", "skip", "wide"}
# 최상위에서 크기와 관계없이 내용을 읽는 박스
TOP_LEVEL_READ = CONTAINERS | {"ftyp", "styp", "meta", "sidx", "pdin"}
SMALL_PAYLOAD = 1 * 1024 * 1024        # 그 밖의 박스는 이 크기 이하일 때만 읽음
MAX_PAYLOAD = 1024 * 1024 * 1024       # moov 등도 이 크기를 넘으면 읽지 않음
MAX_DEPTH = 32


class NotMP4Error(Exception):
    pass


@dataclass
class Box:
    type: str                      # 4글자 타입 (latin-1 디코드, © 포함)
    offset: int                    # 파일 내 시작 위치
    size: int                      # 헤더 포함 전체 크기
    header_size: int               # 8 / 16(largesize) / +16(uuid)
    raw_type: bytes = b""
    payload: bytes | None = None   # 헤더를 제외한 내용. mdat 등은 None
    children: list[Box] = field(default_factory=list)

    @property
    def label(self) -> str:
        """출력용 이름. 인쇄할 수 없는 타입(mdta ilst의 인덱스 등)은 숫자로 표시."""
        if all(32 <= b < 127 or b == 0xA9 for b in self.raw_type):
            return self.type
        return f"#{int.from_bytes(self.raw_type, 'big')}"

    def find(self, path: str) -> Box | None:
        """'mdia/minf/stbl' 형태의 경로로 첫 번째 자손 박스를 찾는다."""
        node: Box | None = self
        for name in path.split("/"):
            node = next((c for c in node.children if c.type == name), None)
            if node is None:
                return None
        return node

    def find_all(self, name: str) -> list[Box]:
        return [c for c in self.children if c.type == name]


def _parse_header(buf: bytes, pos: int, end: int) -> tuple[str, bytes, int, int]:
    """buf[pos:]에서 박스 헤더를 읽는다. end는 부모(또는 파일)의 끝 위치."""
    if end - pos < 8 or len(buf) - pos < 8:
        raise ValueError("헤더가 8바이트보다 짧음")
    size, raw = struct.unpack_from(">I4s", buf, pos)
    hdr = 8
    if size == 1:                                  # 64bit largesize
        if len(buf) - pos < 16:
            raise ValueError("largesize 필드가 잘림")
        size = struct.unpack_from(">Q", buf, pos + 8)[0]
        hdr = 16
    elif size == 0:                                # 파일(부모) 끝까지
        size = end - pos
    if raw == b"uuid":                             # 16바이트 사용자 정의 타입
        hdr += 16
    if size < hdr:
        raise ValueError(f"size {size}가 헤더 크기 {hdr}보다 작음")
    return raw.decode("latin-1"), raw, size, hdr


def _child_offset(box_type: str, payload: bytes, parent_type: str) -> int | None:
    """자식 박스가 시작하는 페이로드 내 위치. 자식이 없는 박스면 None."""
    if parent_type == "ilst":           # ilst 항목(©nam 등)은 data 박스를 담는 컨테이너
        return 0
    if box_type in CONTAINERS:
        return 0
    if box_type == "meta":
        # ISO: FullBox(version+flags 4바이트) 뒤에 자식 / QuickTime: 바로 자식
        return 0 if payload[4:8] == b"hdlr" else 4
    if box_type in ("stsd", "dref"):    # FullBox(4) + entry_count(4)
        return 8
    if box_type in VISUAL_ENTRIES:      # VisualSampleEntry 고정 필드 78바이트
        return 78
    if box_type in AUDIO_ENTRIES:       # AudioSampleEntry 28바이트 (QuickTime v1/v2는 더 김)
        ver = struct.unpack_from(">H", payload, 8)[0] if len(payload) >= 10 else 0
        return {0: 28, 1: 44, 2: 64}.get(ver, 28)
    return None


def _parse_children(buf: bytes, start: int, end: int, base: int,
                    parent_type: str, depth: int, warnings: list[str]) -> list[Box]:
    boxes = []
    pos = start
    while end - pos >= 8:
        try:
            typ, raw, size, hdr = _parse_header(buf, pos, end)
        except ValueError as e:
            warnings.append(f"오프셋 {base + pos}: '{parent_type}' 안의 박스 헤더가 잘못됨 ({e})")
            break
        if pos + size > end:
            warnings.append(f"'{typ}' 박스(오프셋 {base + pos})가 부모 '{parent_type}' 범위를 넘음")
            size = end - pos
        payload = buf[pos + hdr: pos + size]
        box = Box(typ, base + pos, size, hdr, raw, payload)
        skip = _child_offset(typ, payload, parent_type)
        if skip is not None and depth < MAX_DEPTH and len(payload) > skip:
            box.children = _parse_children(payload, skip, len(payload), box.offset + hdr,
                                           typ, depth + 1, warnings)
        boxes.append(box)
        pos += size
    return boxes


def parse_file(path: str) -> tuple[list[Box], int, list[str]]:
    """파일의 최상위 박스를 순서대로 읽는다. mdat 같은 대용량 박스는 건너뛴다(seek)."""
    warnings: list[str] = []
    boxes: list[Box] = []
    with open(path, "rb") as f:
        f.seek(0, 2)
        file_size = f.tell()
        pos = 0
        while file_size - pos >= 8:
            f.seek(pos)
            head = f.read(32)
            try:
                typ, raw, size, hdr = _parse_header(head, 0, file_size - pos)
            except ValueError as e:
                if pos == 0:
                    raise NotMP4Error(f"MP4 박스 구조가 아닙니다 ({e})")
                warnings.append(f"오프셋 {pos}: 최상위 박스 헤더가 잘못됨 ({e})")
                break
            if pos == 0 and not all(32 <= b < 127 for b in raw):
                raise NotMP4Error(
                    f"MP4/ISOBMFF 파일이 아닙니다 (첫 박스 타입이 {raw.hex(' ')}로 문자가 아님)")
            if pos + size > file_size:
                if pos == 0 and typ not in ("ftyp", "moov", "mdat", "free", "skip", "wide"):
                    raise NotMP4Error("MP4/ISOBMFF 파일이 아닙니다 (첫 박스 크기가 파일보다 큼)")
                warnings.append(f"'{typ}' 박스(오프셋 {pos})가 파일 끝을 넘음: "
                                f"선언 {size:,} B, 실제 {file_size - pos:,} B (잘린 파일?)")
                size = file_size - pos
            box = Box(typ, pos, size, hdr, raw)
            plen = size - hdr
            if typ not in SKIP_PAYLOAD and plen <= MAX_PAYLOAD and (
                    typ in TOP_LEVEL_READ or plen <= SMALL_PAYLOAD):
                f.seek(pos + hdr)
                box.payload = f.read(plen)
                skip = _child_offset(typ, box.payload, "")
                if skip is not None:
                    box.children = _parse_children(box.payload, skip, len(box.payload),
                                                   pos + hdr, typ, 1, warnings)
            boxes.append(box)
            pos += size
        if 0 < file_size - pos < 8:
            warnings.append(f"파일 끝에 박스로 해석할 수 없는 {file_size - pos}바이트가 남음")
    return boxes, file_size, warnings


# ═══════════════════════════════════════════════════════════════════════════
# 2. 바이너리 읽기 도우미
# ═══════════════════════════════════════════════════════════════════════════

def u16(b: bytes, o: int) -> int: return struct.unpack_from(">H", b, o)[0]
def u32(b: bytes, o: int) -> int: return struct.unpack_from(">I", b, o)[0]
def u64(b: bytes, o: int) -> int: return struct.unpack_from(">Q", b, o)[0]
def fixed16_16(b: bytes, o: int) -> float: return struct.unpack_from(">i", b, o)[0] / 65536
def fourcc(b: bytes, o: int = 0) -> str: return b[o:o + 4].decode("latin-1")
def full_box(b: bytes) -> tuple[int, int]: return b[0], int.from_bytes(b[1:4], "big")


class BitReader:
    """MSB부터 비트 단위로 읽는다 (AudioSpecificConfig용)."""

    def __init__(self, data: bytes):
        self.data, self.pos = data, 0

    def read(self, n: int) -> int:
        v = 0
        for _ in range(n):
            byte = self.data[self.pos >> 3]
            v = (v << 1) | ((byte >> (7 - (self.pos & 7))) & 1)
            self.pos += 1
        return v


MAC_EPOCH = dt.datetime(1904, 1, 1, tzinfo=dt.timezone.utc)    # MP4 시각의 기준점
UNKNOWN_DURATION = {0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF}


def mac_time(sec: int) -> str | None:
    if not sec:
        return None
    try:
        return (MAC_EPOCH + dt.timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")
    except OverflowError:
        return None


# ═══════════════════════════════════════════════════════════════════════════
# 3. 이름 표
# ═══════════════════════════════════════════════════════════════════════════

BRANDS = {
    "isom": "ISO Base Media 기본", "iso2": "ISOBMFF v2", "iso3": "ISOBMFF v3",
    "iso4": "ISOBMFF v4", "iso5": "ISOBMFF v5 (fragment)", "iso6": "ISOBMFF v6 (fragment)",
    "iso8": "ISOBMFF v8", "iso9": "ISOBMFF v9", "mp41": "MP4 v1", "mp42": "MP4 v2",
    "avc1": "AVC 파일 포맷", "hvc1": "HEVC 파일 포맷", "av01": "AV1 파일 포맷",
    "qt  ": "QuickTime", "M4A ": "Apple 오디오", "M4V ": "Apple 비디오",
    "M4B ": "오디오북", "M4P ": "Apple 보호 오디오", "dash": "MPEG-DASH", "msdh": "DASH 세그먼트",
    "cmfc": "CMAF", "cmf2": "CMAF", "heic": "HEIF 이미지 (HEVC)", "heix": "HEIF 이미지 (HEVC)",
    "mif1": "HEIF 이미지", "msf1": "HEIF 이미지 시퀀스", "avif": "AVIF 이미지",
    "3gp4": "3GPP r4", "3gp5": "3GPP r5", "3gp6": "3GPP r6", "3g2a": "3GPP2",
    "XAVC": "Sony XAVC", "crx ": "Canon RAW (CR3)", "f4v ": "Adobe F4V", "MSNV": "Sony PSP",
}
HANDLERS = {
    "vide": "비디오", "soun": "오디오", "text": "텍스트", "sbtl": "자막", "subt": "자막",
    "clcp": "자막 (CC)", "tmcd": "타임코드", "meta": "메타데이터", "hint": "힌트", "pict": "이미지",
}
CODEC_NAMES = {
    "avc1": "H.264 / AVC", "avc3": "H.264 / AVC", "hvc1": "H.265 / HEVC", "hev1": "H.265 / HEVC",
    "dvh1": "Dolby Vision (HEVC)", "dvhe": "Dolby Vision (HEVC)",
    "dva1": "Dolby Vision (AVC)", "dvav": "Dolby Vision (AVC)",
    "av01": "AV1", "vp08": "VP8", "vp09": "VP9", "mp4v": "MPEG-4 Visual",
    "apch": "Apple ProRes 422 HQ", "apcn": "Apple ProRes 422", "apcs": "Apple ProRes 422 LT",
    "apco": "Apple ProRes 422 Proxy", "ap4h": "Apple ProRes 4444",
    "jpeg": "Motion JPEG", "mjpa": "Motion JPEG",
    "mp4a": "MPEG-4 Audio", "ac-3": "Dolby Digital (AC-3)", "ec-3": "Dolby Digital Plus (E-AC-3)",
    "Opus": "Opus", "fLaC": "FLAC", "alac": "Apple Lossless (ALAC)", "mp3 ": "MP3", ".mp3": "MP3",
    "ipcm": "PCM", "lpcm": "PCM", "sowt": "PCM (리틀엔디언)", "twos": "PCM (빅엔디언)",
    "tx3g": "3GPP Timed Text", "wvtt": "WebVTT", "stpp": "TTML", "c608": "CEA-608 자막",
    "tmcd": "타임코드", "mett": "텍스트 메타데이터", "mebx": "QuickTime 메타데이터",
}
AVC_PROFILES = {66: "Baseline", 77: "Main", 88: "Extended", 100: "High", 110: "High 10",
                122: "High 4:2:2", 244: "High 4:4:4 Predictive", 44: "CAVLC 4:4:4"}
HEVC_PROFILES = {1: "Main", 2: "Main 10", 3: "Main Still Picture", 4: "Range Extensions",
                 5: "High Throughput", 9: "Screen Content"}
AV1_PROFILES = {0: "Main", 1: "High", 2: "Professional"}
OBJECT_TYPES = {0x40: "MPEG-4 Audio", 0x66: "MPEG-2 AAC Main", 0x67: "MPEG-2 AAC-LC",
                0x68: "MPEG-2 AAC SSR", 0x69: "MP3 (MPEG-2)", 0x6B: "MP3 (MPEG-1)",
                0x20: "MPEG-4 Visual", 0x21: "H.264", 0xA5: "AC-3", 0xA6: "E-AC-3", 0xAD: "Opus"}
AAC_OBJECT_TYPES = {1: "AAC Main", 2: "AAC-LC", 3: "AAC SSR", 4: "AAC LTP", 5: "HE-AAC (SBR)",
                    6: "AAC Scalable", 17: "ER AAC-LC", 23: "ER AAC-LD", 29: "HE-AAC v2 (PS)",
                    34: "MP3", 39: "ER AAC-ELD", 42: "xHE-AAC (USAC)"}
AAC_FREQS = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
AAC_CHANNELS = {1: "모노", 2: "스테레오", 3: "3.0", 4: "4.0", 5: "5.0", 6: "5.1", 7: "7.1"}
CHROMA = {0: "4:0:0", 1: "4:2:0", 2: "4:2:2", 3: "4:4:4"}
COLOR_PRIMARIES = {1: "BT.709", 5: "BT.601 (PAL)", 6: "BT.601 (NTSC)", 9: "BT.2020",
                   11: "DCI-P3", 12: "Display P3"}
TRANSFER = {1: "BT.709", 6: "BT.601", 8: "Linear", 13: "sRGB", 14: "BT.2020 (10bit)",
            15: "BT.2020 (12bit)", 16: "PQ (HDR10)", 18: "HLG (HDR)"}
MATRIX = {0: "RGB", 1: "BT.709", 5: "BT.601", 6: "BT.601", 9: "BT.2020 NCL", 10: "BT.2020 CL"}
ILST_NAMES = {
    "©nam": "제목", "©ART": "아티스트", "aART": "앨범 아티스트", "©alb": "앨범", "©day": "날짜",
    "©gen": "장르", "gnre": "장르", "©cmt": "코멘트", "©too": "인코더", "©wrt": "작곡가",
    "©lyr": "가사", "desc": "설명", "ldes": "긴 설명", "cprt": "저작권", "trkn": "트랙 번호",
    "disk": "디스크 번호", "covr": "커버 이미지", "tvsh": "TV 쇼", "©xyz": "촬영 위치",
    "©mak": "제조사", "©mod": "모델", "©swr": "소프트웨어", "©enc": "인코딩한 사람",
}


# ═══════════════════════════════════════════════════════════════════════════
# 4. 개별 박스 해석
# ═══════════════════════════════════════════════════════════════════════════

def parse_ftyp(p: bytes) -> dict:
    return {
        "major_brand": fourcc(p, 0),
        "minor_version": u32(p, 4),
        "compatible_brands": [fourcc(p, i) for i in range(8, len(p) - 3, 4)],
    }


def parse_mvhd(p: bytes) -> dict:
    ver, _ = full_box(p)
    if ver == 1:
        ct, mt, ts, dur = struct.unpack_from(">QQIQ", p, 4)
    else:
        ct, mt, ts, dur = struct.unpack_from(">IIII", p, 4)
    return {"timescale": ts, "duration_ticks": None if dur in UNKNOWN_DURATION else dur,
            "created": mac_time(ct), "modified": mac_time(mt)}


def parse_tkhd(p: bytes) -> dict:
    ver, flags = full_box(p)
    if ver == 1:
        _, _, track_id, _, _ = struct.unpack_from(">QQIIQ", p, 4)
        o = 4 + 32
    else:
        _, _, track_id, _, _ = struct.unpack_from(">IIIII", p, 4)
        o = 4 + 20
    o += 8                                              # reserved
    _layer, alt_group, volume, _ = struct.unpack_from(">hhhH", p, o)
    o += 8
    matrix = struct.unpack_from(">9i", p, o)            # 변환 행렬 a b u c d v x y w
    o += 36
    # 화면 좌표(y축 아래 방향)에서 (1,0)이 (a,b)로 이동 → atan2(b, a)가 시계 방향 회전각
    a, b = matrix[0] / 65536, matrix[1] / 65536
    return {
        "track_id": track_id,
        "enabled": bool(flags & 1),
        "alternate_group": alt_group,
        "volume": volume / 256,
        "display_width": fixed16_16(p, o),
        "display_height": fixed16_16(p, o + 4),
        "rotation": round(math.degrees(math.atan2(b, a))) % 360,
    }


def parse_mdhd(p: bytes) -> dict:
    ver, _ = full_box(p)
    if ver == 1:
        _, _, ts, dur = struct.unpack_from(">QQIQ", p, 4)
        o = 4 + 28
    else:
        _, _, ts, dur = struct.unpack_from(">IIII", p, 4)
        o = 4 + 16
    packed = u16(p, o)
    lang = None
    if packed >= 0x400:                     # ISO 639-2/T: 5비트씩 3글자, 각 값 + 0x60
        lang = "".join(chr(((packed >> s) & 0x1F) + 0x60) for s in (10, 5, 0))
        if not lang.isalpha():
            lang = None
    return {"timescale": ts, "duration_ticks": None if dur in UNKNOWN_DURATION else dur,
            "language": lang}


def parse_hdlr(p: bytes) -> dict:
    name = p[24:]
    if name and name[0] == len(name) - 1 and name[0] > 0:   # QuickTime pascal 문자열
        name = name[1:]
    return {"handler": fourcc(p, 8),
            "handler_name": name.split(b"\0")[0].decode("utf-8", "replace").strip()}


def parse_avcC(p: bytes, fmt: str) -> dict:
    profile, compat, level = p[1], p[2], p[3]
    info = {
        "codec_string": f"{fmt}.{profile:02x}{compat:02x}{level:02x}",
        "profile": AVC_PROFILES.get(profile, f"profile {profile}"),
        "level": f"{level / 10:g}",
        "nal_length_size": (p[4] & 3) + 1,
    }
    i = 5
    n_sps = p[i] & 0x1F
    i += 1
    for _ in range(n_sps):
        i += 2 + u16(p, i)
    n_pps = p[i]
    i += 1
    for _ in range(n_pps):
        i += 2 + u16(p, i)
    # High 계열 프로파일은 SPS/PPS 뒤에 chroma_format, bit_depth 확장이 붙는다
    if profile in (100, 110, 122, 144, 244, 44) and len(p) >= i + 4:
        info["chroma"] = CHROMA[p[i] & 3]
        info["bit_depth"] = (p[i + 1] & 7) + 8
    return info


def parse_hvcC(p: bytes, fmt: str) -> dict:
    b = p[1]
    space, tier, profile = b >> 6, (b >> 5) & 1, b & 0x1F
    compat = u32(p, 2)
    constraint = bytearray(p[6:12])
    level = p[12]
    # RFC 6381 코덱 문자열: 호환 플래그는 비트를 뒤집어 16진수, 끝의 0 바이트는 생략
    rev = int(f"{compat:032b}"[::-1], 2)
    while constraint and constraint[-1] == 0:
        constraint.pop()
    cstr = "".join(f".{x:X}" for x in constraint)
    return {
        "codec_string": f"{fmt}.{['', 'A', 'B', 'C'][space]}{profile}.{rev:X}."
                        f"{'H' if tier else 'L'}{level}{cstr}",
        "profile": HEVC_PROFILES.get(profile, f"profile {profile}"),
        "tier": "High" if tier else "Main",
        "level": f"{level / 30:g}",
        "chroma": CHROMA[p[16] & 3],
        "bit_depth": (p[17] & 7) + 8,
        "nal_length_size": (p[21] & 3) + 1,
    }


def parse_av1C(p: bytes) -> dict:
    profile, level_idx = p[1] >> 5, p[1] & 0x1F
    b = p[2]
    tier, high_bd, twelve, mono = b >> 7, (b >> 6) & 1, (b >> 5) & 1, (b >> 4) & 1
    sub_x, sub_y = (b >> 3) & 1, (b >> 2) & 1
    bit_depth = 12 if (profile == 2 and high_bd and twelve) else (10 if high_bd else 8)
    chroma = "4:0:0" if mono else {(1, 1): "4:2:0", (1, 0): "4:2:2", (0, 0): "4:4:4"}.get(
        (sub_x, sub_y), "?")
    return {
        "codec_string": f"av01.{profile}.{level_idx:02d}{'H' if tier else 'M'}.{bit_depth:02d}",
        "profile": AV1_PROFILES.get(profile, f"profile {profile}"),
        "level": f"{2 + (level_idx >> 2)}.{level_idx & 3}",
        "tier": "High" if tier else "Main",
        "bit_depth": bit_depth,
        "chroma": chroma,
    }


def parse_vpcC(p: bytes, fmt: str) -> dict:
    profile, level = p[4], p[5]
    bit_depth = p[6] >> 4
    sub = (p[6] >> 1) & 7
    return {
        "codec_string": f"{fmt}.{profile:02d}.{level:02d}.{bit_depth:02d}",
        "profile": f"Profile {profile}",
        "level": f"{level / 10:g}",
        "bit_depth": bit_depth,
        "chroma": {0: "4:2:0", 1: "4:2:0", 2: "4:2:2", 3: "4:4:4"}.get(sub, "?"),
    }


def parse_audio_specific_config(asc: bytes) -> dict:
    br = BitReader(asc)

    def object_type() -> int:
        t = br.read(5)
        return 32 + br.read(6) if t == 31 else t

    def frequency() -> int | None:
        idx = br.read(4)
        if idx == 15:
            return br.read(24)
        return AAC_FREQS[idx] if idx < len(AAC_FREQS) else None

    aot = object_type()
    rate = frequency()
    ch = br.read(4)
    info = {
        "codec_string": f"mp4a.40.{aot}",
        "aac_profile": AAC_OBJECT_TYPES.get(aot, f"AOT {aot}"),
        "asc_sample_rate": rate,
        "asc_channels": AAC_CHANNELS.get(ch, "PCE에 정의" if ch == 0 else str(ch)),
    }
    if aot in (5, 29):                          # 명시적 SBR/PS 시그널링
        info["sbr_sample_rate"] = frequency()
        info["core_profile"] = AAC_OBJECT_TYPES.get(object_type())
    return info


def parse_esds(p: bytes) -> dict:
    data = p[4:]                                # FullBox 헤더 건너뜀

    def descriptor(i: int) -> tuple[int, int, int]:
        tag = data[i]
        i += 1
        size = 0
        for _ in range(4):                      # 크기: 7비트씩, 최상위 비트가 1이면 계속
            b = data[i]
            i += 1
            size = (size << 7) | (b & 0x7F)
            if not b & 0x80:
                break
        return tag, size, i

    info: dict = {}
    tag, size, i = descriptor(0)
    if tag == 0x03:                             # ES_Descriptor
        i += 2                                  # ES_ID
        flags = data[i]
        i += 1
        if flags & 0x80:
            i += 2
        if flags & 0x40:
            i += 1 + data[i]
        if flags & 0x20:
            i += 2
        tag, size, i = descriptor(i)
    if tag != 0x04:                             # DecoderConfigDescriptor
        return info
    oti = data[i]
    info["object_type"] = OBJECT_TYPES.get(oti, f"0x{oti:02X}")
    max_br, avg_br = struct.unpack_from(">II", data, i + 5)
    if max_br:
        info["esds_max_bitrate"] = max_br
    if avg_br:
        info["esds_avg_bitrate"] = avg_br
    end = i + size
    i += 13
    if oti == 0x40 and i < end:
        tag, size, i = descriptor(i)
        if tag == 0x05:                         # DecoderSpecificInfo = AudioSpecificConfig
            info.update(parse_audio_specific_config(data[i:i + size]))
    elif oti in (0x69, 0x6B):
        info["codec_string"] = f"mp4a.{oti:02X}"
        info["codec"] = "MP3"
    elif oti in (0x66, 0x67, 0x68):
        info["codec_string"] = f"mp4a.{oti:02X}"
    return info


def parse_colr(p: bytes) -> dict:
    kind = fourcc(p, 0)
    if kind in ("nclx", "nclc"):
        pri, trc, mat = struct.unpack_from(">HHH", p, 4)
        info = {"primaries": COLOR_PRIMARIES.get(pri, str(pri)),
                "transfer": TRANSFER.get(trc, str(trc)),
                "matrix": MATRIX.get(mat, str(mat)),
                "hdr": trc in (16, 18)}
        if kind == "nclx" and len(p) > 10:
            info["full_range"] = bool(p[10] & 0x80)
        return info
    return {"icc_profile": f"{kind}, {len(p) - 4} bytes"}


def parse_sample_entry(entry: Box, handler: str | None) -> dict:
    fmt = entry.type
    p = entry.payload or b""
    info: dict = {"format": fmt}

    # 암호화된 트랙(encv/enca)은 sinf/frma에 원래 포맷이 있다
    frma = entry.find("sinf/frma")
    if frma and frma.payload:
        info["encrypted"] = True
        info["original_format"] = fourcc(frma.payload)
        schm = entry.find("sinf/schm")
        if schm and schm.payload and len(schm.payload) >= 8:
            info["protection_scheme"] = fourcc(schm.payload, 4)
    base_fmt = info.get("original_format", fmt)
    info["codec"] = CODEC_NAMES.get(base_fmt, base_fmt)

    if fmt in VISUAL_ENTRIES or (handler == "vide" and len(p) >= 78):
        info["width"], info["height"] = struct.unpack_from(">HH", p, 24)
        n = min(p[42], 31)
        comp = p[43:43 + n].decode("latin-1").strip("\0 ")
        if comp:
            info["compressor"] = comp
        info["depth"] = u16(p, 74)
    elif fmt in AUDIO_ENTRIES or (handler == "soun" and len(p) >= 28):
        ver = u16(p, 8)
        ch, bits = struct.unpack_from(">HH", p, 16)
        rate: float = u32(p, 24) >> 16
        if ver == 2 and len(p) >= 52:           # QuickTime SoundDescription v2
            rate = struct.unpack_from(">d", p, 32)[0]
            ch = u32(p, 40)
            bits = u32(p, 48)
        info["sample_rate"] = int(rate)
        info["channels"] = ch
        info["sample_size"] = bits

    # 자식 박스 (QuickTime은 wave 안에 esds를 넣기도 함)
    children = list(entry.children)
    wave = entry.find("wave")
    if wave:
        children += wave.children
    for c in children:
        cp = c.payload or b""
        try:
            if c.type == "avcC":
                info.update(parse_avcC(cp, base_fmt))
            elif c.type == "hvcC":
                info.update(parse_hvcC(cp, base_fmt))
            elif c.type == "av1C":
                info.update(parse_av1C(cp))
            elif c.type == "vpcC":
                info.update(parse_vpcC(cp, base_fmt))
            elif c.type == "esds":
                info.update(parse_esds(cp))
            elif c.type == "dOps":
                info.update({"codec_string": "opus", "channels": cp[1],
                             "pre_skip": u16(cp, 2), "input_sample_rate": u32(cp, 4)})
            elif c.type == "colr":
                info["color"] = parse_colr(cp)
            elif c.type == "pasp":
                h, v = struct.unpack_from(">II", cp, 0)
                if h != v:
                    info["pixel_aspect"] = f"{h}:{v}"
            elif c.type == "btrt":
                _, mx, avg = struct.unpack_from(">III", cp, 0)
                if mx:
                    info["btrt_max_bitrate"] = mx
                if avg:
                    info["btrt_avg_bitrate"] = avg
            elif c.type in ("dvcC", "dvvC"):
                info["dolby_vision_profile"] = cp[2] >> 1
        except (struct.error, IndexError, KeyError) as e:
            info.setdefault("warnings", []).append(f"{c.type} 해석 실패: {e}")

    if "aac_profile" in info:
        info["codec"] = info["aac_profile"]
    return info


def analyze_sample_table(stbl: Box) -> dict:
    s: dict = {}
    if (b := stbl.find("stts")) and b.payload:          # 샘플별 재생 시간 (DTS 간격)
        p = b.payload
        n = u32(p, 4)
        entries = list(struct.iter_unpack(">II", p[8:8 + 8 * n]))
        s["stts_sample_count"] = sum(c for c, _ in entries)
        s["total_delta"] = sum(c * d for c, d in entries)
        if entries:
            weights = Counter()
            for c, d in entries:
                weights[d] += c
            s["frame_delta"] = weights.most_common(1)[0][0]
            # 마지막 샘플 하나만 길이가 다른 경우는 흔하므로 무시하고 고정 프레임레이트 판정
            body = entries[:-1] if len(entries) > 1 and entries[-1][0] == 1 else entries
            s["constant_frame_rate"] = len({d for _, d in body}) == 1

    if (b := stbl.find("stsz")) and b.payload:          # 샘플 크기
        p = b.payload
        fixed, count = struct.unpack_from(">II", p, 4)
        if fixed:
            s["total_bytes"], s["max_sample_size"] = fixed * count, fixed
        else:
            sizes = struct.unpack_from(f">{count}I", p, 12)
            s["total_bytes"] = sum(sizes)
            s["max_sample_size"] = max(sizes, default=0)
        s["sample_count"] = count
    elif (b := stbl.find("stz2")) and b.payload:        # 압축된 샘플 크기 표
        p = b.payload
        bits, count = p[7], u32(p, 8)
        if bits == 4:
            raw = p[12:12 + (count + 1) // 2]
            sizes = [x for byte in raw for x in (byte >> 4, byte & 0xF)][:count]
        else:
            sizes = struct.unpack_from(f">{count}{'B' if bits == 8 else 'H'}", p, 12)
        s["total_bytes"] = sum(sizes)
        s["max_sample_size"] = max(sizes, default=0)
        s["sample_count"] = count

    if (b := stbl.find("stss")) and b.payload:          # 키프레임 목록 (없으면 전부 키프레임)
        s["keyframes"] = u32(b.payload, 4)
    s["has_ctts"] = stbl.find("ctts") is not None       # PTS≠DTS → B-프레임
    for name in ("stco", "co64"):
        if (b := stbl.find(name)) and b.payload:
            s["chunk_count"] = u32(b.payload, 4)
            s["chunk_offset_bits"] = 64 if name == "co64" else 32
    return s


def parse_trex(mvex: Box) -> dict[int, dict]:
    out = {}
    for trex in mvex.find_all("trex"):
        p = trex.payload
        tid, _sdi, dur, size, flags = struct.unpack_from(">IIIII", p, 4)
        out[tid] = {"duration": dur, "size": size, "flags": flags}
    return out


def analyze_fragments(top: list[Box], trex: dict[int, dict]) -> dict[int, dict]:
    """moof/traf/trun을 모두 훑어 트랙별 샘플 수, 크기, 길이, 키프레임 수를 합산한다."""
    stats: dict[int, dict] = {}
    for moof in (b for b in top if b.type == "moof"):
        for traf in moof.find_all("traf"):
            tfhd = traf.find("tfhd")
            if not tfhd or not tfhd.payload:
                continue
            p = tfhd.payload
            _, flags = full_box(p)
            tid = u32(p, 4)
            d = dict(trex.get(tid, {}))
            o = 8
            if flags & 0x01: o += 8                       # base_data_offset
            if flags & 0x02: o += 4                       # sample_description_index
            if flags & 0x08: d["duration"] = u32(p, o); o += 4
            if flags & 0x10: d["size"] = u32(p, o); o += 4
            if flags & 0x20: d["flags"] = u32(p, o); o += 4
            st = stats.setdefault(tid, {"fragments": 0, "sample_count": 0, "total_bytes": 0,
                                        "duration_ticks": 0, "keyframes": 0, "has_ctts": False})
            st["fragments"] += 1
            for trun in traf.find_all("trun"):
                p = trun.payload
                _, tf = full_box(p)
                n = u32(p, 4)
                o = 8
                if tf & 0x001: o += 4                     # data_offset
                first_flags = None
                if tf & 0x004:
                    first_flags = u32(p, o)
                    o += 4
                present = [name for bit, name in ((0x100, "duration"), (0x200, "size"),
                                                  (0x400, "flags"), (0x800, "cto")) if tf & bit]
                if "cto" in present:
                    st["has_ctts"] = True
                idx = {name: i for i, name in enumerate(present)}
                rows = (struct.iter_unpack(">" + "I" * len(present), p[o:o + 4 * len(present) * n])
                        if present else itertools.repeat((), n))
                for k, row in enumerate(rows):
                    dur = row[idx["duration"]] if "duration" in idx else d.get("duration", 0)
                    size = row[idx["size"]] if "size" in idx else d.get("size", 0)
                    if k == 0 and first_flags is not None:
                        fl = first_flags
                    else:
                        fl = row[idx["flags"]] if "flags" in idx else d.get("flags", 0)
                    st["sample_count"] += 1
                    st["total_bytes"] += size
                    st["duration_ticks"] += dur
                    if not fl & 0x10000:                  # sample_is_non_sync_sample 비트
                        st["keyframes"] += 1
    return stats


# ═══════════════════════════════════════════════════════════════════════════
# 5. 메타데이터
# ═══════════════════════════════════════════════════════════════════════════

def decode_data_box(p: bytes):
    """ilst 항목 안의 data 박스: type(4) + locale(4) + 값."""
    dtype = u32(p, 0) & 0xFFFFFF
    v = p[8:]
    if dtype == 1:
        return v.decode("utf-8", "replace")
    if dtype == 2:
        return v.decode("utf-16-be", "replace")
    if dtype in (13, 14, 27):
        kind = {13: "JPEG", 14: "PNG", 27: "BMP"}[dtype]
        return f"<{kind} 이미지, {len(v):,} bytes>"
    if dtype in (21, 22) and len(v) in (1, 2, 3, 4, 8):
        return int.from_bytes(v, "big", signed=dtype == 21)
    if dtype == 23 and len(v) == 4:
        return struct.unpack(">f", v)[0]
    if dtype == 24 and len(v) == 8:
        return struct.unpack(">d", v)[0]
    return f"<바이너리 {len(v):,} bytes>"


def parse_keys(p: bytes) -> list[str]:
    n, o, keys = u32(p, 4), 8, []
    for _ in range(n):
        size = u32(p, o)
        keys.append(p[o + 8:o + size].decode("utf-8", "replace"))
        o += size
    return keys


def parse_ilst(ilst: Box, keys: list[str] | None) -> dict:
    out = {}
    for item in ilst.children:
        if keys is not None:                    # QuickTime mdta: 타입이 keys의 1부터 시작하는 인덱스
            i = int.from_bytes(item.raw_type, "big")
            name = keys[i - 1] if 0 < i <= len(keys) else item.label
        elif item.type == "----":               # 자유 형식: mean + name + data
            nm = item.find("name")
            name = nm.payload[4:].decode("utf-8", "replace") if nm and nm.payload else "----"
        else:
            name = item.type
        values = []
        for data in item.find_all("data"):
            p = data.payload or b""
            if keys is None and item.type in ("trkn", "disk") and len(p) >= 14:
                num, total = u16(p, 10), u16(p, 12)
                values.append(f"{num}/{total}" if total else str(num))
            else:
                values.append(decode_data_box(p))
        if values:
            label = f"{ILST_NAMES[name]} ({name})" if name in ILST_NAMES else name
            out[label] = values[0] if len(values) == 1 else values
    return out


def collect_metadata(moov: Box) -> dict:
    meta: dict = {}
    for m in (moov.find("udta/meta"), moov.find("meta")):
        if not m:
            continue
        ilst = m.find("ilst")
        keys_box = m.find("keys")
        keys = parse_keys(keys_box.payload) if keys_box and keys_box.payload else None
        if ilst:
            meta.update(parse_ilst(ilst, keys))
    udta = moov.find("udta")
    if udta:                                    # QuickTime 방식 © 텍스트: 길이(2) + 언어(2) + 문자열
        for c in udta.children:
            p = c.payload
            if c.raw_type[:1] == b"\xa9" and p and len(p) >= 4 and 4 + u16(p, 0) <= len(p):
                text = p[4:4 + u16(p, 0)].decode("utf-8", "replace")
                label = f"{ILST_NAMES[c.type]} ({c.type})" if c.type in ILST_NAMES else c.type
                meta.setdefault(label, text)
    return meta


# ═══════════════════════════════════════════════════════════════════════════
# 6. 전체 분석
# ═══════════════════════════════════════════════════════════════════════════

def _try(warnings: list[str], what: str, fn, *args):
    try:
        return fn(*args)
    except (struct.error, IndexError, ValueError, KeyError, ZeroDivisionError, TypeError) as e:
        warnings.append(f"{what} 해석 실패: {type(e).__name__}: {e}")
        return None


def analyze_track(trak: Box, warnings: list[str]) -> dict:
    t: dict = {}
    if (b := trak.find("tkhd")) and b.payload:
        t.update(_try(warnings, "tkhd", parse_tkhd, b.payload) or {})
    if (b := trak.find("mdia/mdhd")) and b.payload:
        t.update(_try(warnings, "mdhd", parse_mdhd, b.payload) or {})
    if (b := trak.find("mdia/hdlr")) and b.payload:
        t.update(_try(warnings, "hdlr", parse_hdlr, b.payload) or {})
    handler = t.get("handler")
    t["type_name"] = HANDLERS.get(handler, handler or "알 수 없음")

    stbl = trak.find("mdia/minf/stbl")
    if stbl:
        stsd = stbl.find("stsd")
        if stsd and stsd.children:
            t["codec"] = _try(warnings, f"트랙 {t.get('track_id')} stsd",
                              parse_sample_entry, stsd.children[0], handler) or {}
            if len(stsd.children) > 1:
                t["sample_entries"] = [c.label for c in stsd.children]
        t.update(_try(warnings, f"트랙 {t.get('track_id')} 샘플 테이블",
                      analyze_sample_table, stbl) or {})
    return t


def finalize_track(t: dict, frag: dict | None) -> None:
    """조각(fragment) 통계를 합치고 재생 시간, 비트레이트, 프레임레이트를 계산한다."""
    if frag and frag["sample_count"]:
        t["fragments"] = frag["fragments"]
        if not t.get("sample_count"):
            t["sample_count"] = frag["sample_count"]
            t["total_bytes"] = frag["total_bytes"]
            t["keyframes"] = frag["keyframes"]
            t["has_ctts"] = t.get("has_ctts") or frag["has_ctts"]
        if not t.get("duration_ticks"):
            t["duration_ticks"] = frag["duration_ticks"]
    ts = t.get("timescale")
    dur = t.get("duration_ticks")
    t["duration"] = dur / ts if ts and dur else None
    if t.get("total_bytes") and t["duration"]:
        t["bitrate"] = t["total_bytes"] * 8 / t["duration"]
    if t.get("handler") == "vide" and t.get("sample_count") and t["duration"]:
        t["avg_fps"] = t["sample_count"] / t["duration"]
        if ts and t.get("frame_delta"):
            t["fps"] = ts / t["frame_delta"]


def analyze(path: str) -> tuple[dict, Box]:
    boxes, file_size, warnings = parse_file(path)
    root = Box("<file>", 0, file_size, 0, children=boxes)
    types = [b.type for b in boxes]
    if not {"ftyp", "moov", "moof", "styp"} & set(types):
        raise NotMP4Error("ftyp / moov 박스가 없어 MP4로 볼 수 없습니다")

    info: dict = {"file": path, "file_size": file_size}

    # 레이아웃: moov가 mdat보다 앞인지(faststart), fragment 여부
    moov_i = types.index("moov") if "moov" in types else None
    mdat_i = types.index("mdat") if "mdat" in types else None
    moov = root.find("moov")
    info["layout"] = {
        "top_level": types,
        "faststart": (moov_i < mdat_i) if moov_i is not None and mdat_i is not None else None,
        "fragmented": "moof" in types or bool(moov and moov.find("mvex")),
    }

    if (b := root.find("ftyp")) and b.payload:
        info["ftyp"] = _try(warnings, "ftyp", parse_ftyp, b.payload)

    if not moov:
        warnings.append("moov 박스가 없습니다 (녹화가 중단된 파일, 또는 HEIF 같은 이미지 파일)")
        info["tracks"] = []
    else:
        movie: dict = {}
        if (b := moov.find("mvhd")) and b.payload:
            movie = _try(warnings, "mvhd", parse_mvhd, b.payload) or {}
        mvex = moov.find("mvex")
        trex = _try(warnings, "trex", parse_trex, mvex) or {} if mvex else {}
        if mvex and (b := mvex.find("mehd")) and b.payload and not movie.get("duration_ticks"):
            ver, _ = full_box(b.payload)
            movie["duration_ticks"] = u64(b.payload, 4) if ver == 1 else u32(b.payload, 4)
        frags = _try(warnings, "fragment", analyze_fragments, boxes, trex) or {}

        tracks = []
        for trak in moov.find_all("trak"):
            t = analyze_track(trak, warnings)
            finalize_track(t, frags.get(t.get("track_id")))
            tracks.append(t)
        info["tracks"] = tracks

        ts = movie.get("timescale")
        dur = movie.get("duration_ticks")
        movie["duration"] = dur / ts if ts and dur else None
        if not movie["duration"]:          # fragmented: 가장 긴 트랙 길이로 대신함
            movie["duration"] = max((t["duration"] or 0 for t in tracks), default=0) or None
        if movie["duration"]:
            movie["overall_bitrate"] = file_size * 8 / movie["duration"]
        if frags:
            movie["fragment_count"] = types.count("moof")
        info["movie"] = movie
        info["metadata"] = _try(warnings, "메타데이터", collect_metadata, moov) or {}

    info["warnings"] = warnings
    return info, root


# ═══════════════════════════════════════════════════════════════════════════
# 7. 출력
# ═══════════════════════════════════════════════════════════════════════════

def fmt_size(n: float) -> str:
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TiB"


def fmt_duration(sec: float | None) -> str:
    if not sec:
        return "알 수 없음"
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def fmt_bitrate(bps: float | None) -> str:
    if not bps:
        return "-"
    if bps >= 1e6:
        return f"{bps / 1e6:.2f} Mbps"
    if bps >= 1e3:
        return f"{bps / 1e3:.1f} kbps"
    return f"{bps:.0f} bps"


def yesno(v) -> str:
    return "알 수 없음" if v is None else ("예" if v else "아니오")


def _width(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


def kv(label: str, value, indent: int = 2, width: int = 16) -> None:
    print(" " * indent + label + " " * max(1, width - _width(label)) + ": " + str(value))


def brand(b: str) -> str:
    return f"'{b}'" + (f" ({BRANDS[b]})" if b in BRANDS else "")


def print_summary(info: dict) -> None:
    kv("파일", info["file"], 0, 12)
    kv("크기", f"{fmt_size(info['file_size'])} ({info['file_size']:,} bytes)", 0, 12)
    lay = info["layout"]
    top = lay["top_level"]
    order = " → ".join(top[:8]) + (f" → … (총 {len(top)}개)" if len(top) > 8 else "")
    kv("최상위 박스", order, 0, 12)
    kv("faststart", f"{yesno(lay['faststart'])}   (moov가 mdat보다 앞에 있는가)", 0, 12)
    kv("fragmented", yesno(lay["fragmented"]), 0, 12)

    if f := info.get("ftyp"):
        print("\n[ftyp] 파일 타입")
        kv("major_brand", brand(f["major_brand"]))
        kv("minor_version", f["minor_version"])
        kv("compatible", ", ".join(f"'{b}'" for b in f["compatible_brands"]) or "(없음)")

    if m := info.get("movie"):
        print("\n[moov/mvhd] 무비")
        kv("재생 시간", fmt_duration(m.get("duration")))
        kv("timescale", f"{m.get('timescale')} (초당 틱 수)")
        if m.get("created"):
            kv("생성 시각", m["created"])
        if m.get("modified") and m.get("modified") != m.get("created"):
            kv("수정 시각", m["modified"])
        kv("전체 비트레이트", fmt_bitrate(m.get("overall_bitrate")))
        if m.get("fragment_count"):
            kv("조각(moof) 수", m["fragment_count"])

    for t in info.get("tracks", []):
        state = "" if t.get("enabled", True) else "  (비활성)"
        print(f"\n[트랙 {t.get('track_id')}] {t['type_name']} ('{t.get('handler')}'){state}")
        c = t.get("codec") or {}
        if c:
            line = c.get("codec", c.get("format"))
            if c.get("codec_string"):
                line += f"  [{c['codec_string']}]"
            kv("코덱", line)
            detail = [x for x in (
                c.get("profile") and f"{c['profile']} 프로파일",
                c.get("tier") and c.get("format", "").startswith(("hvc", "hev")) and f"{c['tier']} tier",
                c.get("level") and f"레벨 {c['level']}",
                c.get("chroma"), c.get("bit_depth") and f"{c['bit_depth']}bit") if x]
            if detail:
                kv("코덱 상세", ", ".join(detail))
            if c.get("encrypted"):
                kv("암호화", f"예 (원래 포맷 '{c.get('original_format')}', "
                             f"방식 '{c.get('protection_scheme', '?')}')")
        if t.get("handler") == "vide":
            if "width" in c:
                kv("해상도", f"{c['width']}x{c['height']}"
                   + (f" (픽셀 비율 {c['pixel_aspect']})" if c.get("pixel_aspect") else ""))
            dw, dh = t.get("display_width"), t.get("display_height")
            if dw and (round(dw), round(dh)) != (c.get("width"), c.get("height")):
                kv("표시 크기", f"{dw:g}x{dh:g} (tkhd)")
            if t.get("rotation"):
                r = t["rotation"]
                kv("회전", f"시계 방향 {r}° (= 반시계 {(360 - r) % 360}°, tkhd 변환 행렬)"
                   + ("  → 세로 영상으로 표시" if r in (90, 270) else ""))
            if t.get("fps"):
                cfr = t.get("constant_frame_rate")
                kv("프레임레이트", f"{t['fps']:.3f} fps"
                   + {True: " (고정)", False: f" (가변, 평균 {t.get('avg_fps', 0):.3f})"}.get(cfr, ""))
            elif t.get("avg_fps"):
                kv("프레임레이트", f"평균 {t['avg_fps']:.3f} fps")
            if col := c.get("color"):
                if "primaries" in col:
                    rng = {True: ", full range", False: ", limited range"}.get(col.get("full_range"), "")
                    kv("색 정보", f"원색 {col['primaries']} / 전달 {col['transfer']} / "
                                  f"행렬 {col['matrix']}{rng}" + ("  ★ HDR" if col["hdr"] else ""))
                else:
                    kv("색 정보", col["icc_profile"])
            if "dolby_vision_profile" in c:
                kv("Dolby Vision", f"프로파일 {c['dolby_vision_profile']}")
        elif t.get("handler") == "soun":
            if c.get("sample_rate") or c.get("asc_sample_rate"):
                rate = c.get("asc_sample_rate") or c.get("sample_rate")
                kv("샘플레이트", f"{rate:,} Hz"
                   + (f" (SBR {c['sbr_sample_rate']:,} Hz)" if c.get("sbr_sample_rate") else ""))
            if c.get("channels") is not None:
                ch = f"{c['channels']}ch"
                if c.get("asc_channels"):
                    ch += f" ({c['asc_channels']})"
                kv("채널", ch)
        if t.get("language"):
            kv("언어", t["language"])
        kv("재생 시간", fmt_duration(t.get("duration")))
        kv("timescale", t.get("timescale"))
        if t.get("sample_count") is not None:
            kv("샘플 수", f"{t['sample_count']:,}")
        if t.get("handler") == "vide":
            kf = t.get("keyframes")
            kv("키프레임", "전부 (stss 없음)" if kf is None else f"{kf:,}")
            kv("B-프레임", "있음 (ctts 존재)" if t.get("has_ctts") else "없음")
        if t.get("total_bytes"):
            kv("데이터 크기", f"{fmt_size(t['total_bytes'])} ({t['total_bytes']:,} bytes)")
        kv("비트레이트", fmt_bitrate(t.get("bitrate")))
        if t.get("chunk_count") is not None:
            kv("청크 수", f"{t['chunk_count']:,} ({t.get('chunk_offset_bits')}bit 오프셋)")
        if t.get("fragments"):
            kv("조각 수", t["fragments"])
        if t.get("handler_name"):
            kv("핸들러 이름", t["handler_name"])
        if t.get("sample_entries"):
            kv("샘플 엔트리", ", ".join(t["sample_entries"]))
        for w in c.get("warnings", []):
            kv("경고", w)

    if meta := info.get("metadata"):
        print("\n[메타데이터]")
        for k, v in meta.items():
            kv(k, v, width=24)

    if info.get("warnings"):
        print("\n[경고]")
        for w in info["warnings"]:
            print(f"  - {w}")


def box_note(b: Box) -> str:
    p = b.payload
    try:
        if b.type == "mdat":
            return "  미디어 데이터"
        if b.type in ("free", "skip"):
            return "  빈 공간"
        if not p:
            return ""
        if b.type in ("ftyp", "styp"):
            return f"  major='{fourcc(p)}'"
        if b.type == "hdlr":
            return f"  handler='{fourcc(p, 8)}'"
        if b.type in ("mvhd", "mdhd"):
            return f"  timescale={(parse_mvhd if b.type == 'mvhd' else parse_mdhd)(p)['timescale']}"
        if b.type == "tkhd":
            return f"  track_id={parse_tkhd(p)['track_id']}"
        if b.type in ("stsd", "stss", "stco", "co64", "stts", "stsc", "ctts", "elst", "trun"):
            return f"  entries={u32(p, 4):,}"
        if b.type == "stsz":
            return f"  samples={u32(p, 8):,}"
        if b.type in VISUAL_ENTRIES:
            w, h = struct.unpack_from(">HH", p, 24)
            return f"  {w}x{h}"
        if b.type in AUDIO_ENTRIES:
            return f"  {u32(p, 24) >> 16} Hz, {u16(p, 16)}ch"
    except (struct.error, IndexError, KeyError):
        pass
    return ""


def print_tree(boxes: list[Box], prefix: str = "", limit: int | None = 5) -> None:
    seen: Counter = Counter()
    shown, hidden = [], Counter()
    for b in boxes:
        seen[b.type] += 1
        if limit and seen[b.type] > limit:
            hidden[b.label] += 1
        else:
            shown.append(b)
    items: list[Box | None] = shown + ([None] if hidden else [])
    for i, b in enumerate(items):
        last = i == len(items) - 1
        branch = "└── " if last else "├── "
        if b is None:
            extra = ", ".join(f"{k} ×{v}" for k, v in hidden.items())
            print(f"{prefix}{branch}… 생략: {extra}  (--all로 전부 표시)")
            continue
        print(f"{prefix}{branch}{b.label:<4}  @{b.offset:<10,} {fmt_size(b.size):>10}{box_note(b)}")
        print_tree(b.children, prefix + ("    " if last else "│   "), limit)


def tree_to_dict(b: Box) -> dict:
    d = {"type": b.label, "offset": b.offset, "size": b.size}
    if b.children:
        d["children"] = [tree_to_dict(c) for c in b.children]
    return d


def main() -> int:
    ap = argparse.ArgumentParser(description="MP4(ISOBMFF) 파일을 직접 파싱해서 정보를 출력한다.")
    ap.add_argument("files", nargs="+", help="분석할 파일 (mp4, mov, m4a, 3gp …)")
    ap.add_argument("-t", "--tree", action="store_true", help="박스 트리 출력")
    ap.add_argument("-j", "--json", action="store_true", help="JSON으로 출력")
    ap.add_argument("--all", action="store_true", help="트리에서 반복되는 박스를 생략하지 않음")
    args = ap.parse_args()

    rc = 0
    results = []
    for n, path in enumerate(args.files):
        try:
            info, root = analyze(path)
        except OSError as e:
            print(f"{path}: 파일을 열 수 없습니다 ({e.strerror})", file=sys.stderr)
            rc = 1
            continue
        except NotMP4Error as e:
            print(f"{path}: {e}", file=sys.stderr)
            rc = 1
            continue

        if args.json:
            if args.tree:
                info["tree"] = [tree_to_dict(b) for b in root.children]
            results.append(info)
            continue
        if n:
            print("\n" + "═" * 72 + "\n")
        print_summary(info)
        if args.tree:
            print("\n[박스 트리]  이름  @오프셋  크기")
            print_tree(root.children, limit=None if args.all else 5)

    if args.json and results:
        out = results[0] if len(results) == 1 else results
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return rc


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:          # `| head` 등으로 출력이 끊긴 경우
        # 종료 시 남은 stdout 버퍼를 비우다 또 실패하지 않도록 /dev/null로 돌린다
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, sys.stdout.fileno())
        sys.exit(0)
