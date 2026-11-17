# Comic Viewer

ZIP / 7Z / RAR 압축 파일이나 폴더 안의 이미지를 한 장씩 넘겨 보는 Electron 뷰어.

## 실행

```bash
npm install
npm start                       # 빈 창 → 드래그 앤 드롭 또는 O 키로 열기
npm start -- ~/comics/vol1.zip  # 압축 파일 열기
npm start -- ~/pics/003.jpg     # 같은 폴더의 이미지들을 003.jpg부터 보기
npm run dist                    # 설치 파일 빌드 (확장자 연결 포함)
```

## 지원 형식
- 압축: zip, cbz, 7z, cb7, rar, cbr (RAR5 포함, 암호 없는 파일)
- 이미지: jpg, jpeg, png, gif, webp, bmp, avif, svg
- 압축 파일 안의 하위 폴더도 포함하며, 파일명은 자연 정렬(1, 2, 10 …)합니다.

## 단축키
| 키 | 동작 |
|---|---|
| Space, →, ↓, PageDown, 화면 오른쪽 클릭 | 다음 |
| Shift+Space, ←, ↑, PageUp, Backspace, 화면 왼쪽 클릭 | 이전 |
| Home / End | 처음 / 마지막 |
| W | 맞춤 방식 전환 (화면 / 너비 / 원본) |
| F, Enter | 전체화면 |
| O | 파일 열기 |
