#!/bin/sh
# 환경변수 → FreeSWITCH 전역 변수(svbs_vars.xml) 생성 후 원래 entrypoint 실행
# 주의: 값에 XML 특수문자(< > & ")를 넣지 말 것
set -e

VARS=/etc/freeswitch/svbs_vars.xml

{
  echo '<include>'
  echo "  <X-PRE-PROCESS cmd=\"set\" data=\"svbs_api_url=${SVBS_API_URL:-http://127.0.0.1:3000}\"/>"
  echo "  <X-PRE-PROCESS cmd=\"set\" data=\"svbs_xmlcurl_credentials=${FS_XMLCURL_USER:-freeswitch}:${FS_XMLCURL_PASSWORD:-change-me}\"/>"
  echo "  <X-PRE-PROCESS cmd=\"set\" data=\"esl_listen_ip=${FS_ESL_LISTEN_IP:-127.0.0.1}\"/>"
  echo "  <X-PRE-PROCESS cmd=\"set\" data=\"esl_password=${FS_ESL_PASSWORD:-ClueCon}\"/>"
  # 공인 IP 를 알고 있으면 STUN 조회 대신 고정 (모바일 NAT 환경에서 SDP 에 들어갈 주소)
  if [ -n "$EXTERNAL_IP" ]; then
    echo "  <X-PRE-PROCESS cmd=\"set\" data=\"external_rtp_ip=${EXTERNAL_IP}\"/>"
    echo "  <X-PRE-PROCESS cmd=\"set\" data=\"external_sip_ip=${EXTERNAL_IP}\"/>"
  fi
  echo '</include>'
} > "$VARS"

exec /entrypoint.sh "$@"
