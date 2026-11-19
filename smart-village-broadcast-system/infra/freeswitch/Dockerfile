# safarov/freeswitch (FreeSWITCH 1.11.x, Debian 패키지 기반). 재현성을 위해 digest 고정
FROM safarov/freeswitch:latest@sha256:f156e01a96d48944078ed7f0e24304be63ea15f6466cf607a0aeb6cb47761da7

# vanilla 설정을 기본으로 깔고, 필요한 부분만 덮어쓴다.
# - mod_xml_curl 활성화 (SIP 계정은 백엔드 /freeswitch/directory 에서 조회)
# - 데모 사용자(1000~1019, 비밀번호 1234) 제거
# - vars.xml 끝에서 svbs_vars.xml(컨테이너 기동 시 환경변수로 생성)을 include
RUN mkdir -p /etc/freeswitch \
 && cp -a /usr/share/freeswitch/conf/vanilla/. /etc/freeswitch/ \
 && sed -i 's|<!-- <load module="mod_xml_curl"/> -->|<load module="mod_xml_curl"/>|' \
      /etc/freeswitch/autoload_configs/modules.conf.xml \
 && rm -f /etc/freeswitch/directory/default/*.xml \
 && sed -i 's|^</include>|  <X-PRE-PROCESS cmd="include" data="svbs_vars.xml"/>\n</include>|' \
      /etc/freeswitch/vars.xml \
 && mkdir -p /recordings/upload /recordings/phone

COPY conf/ /etc/freeswitch/
COPY scripts/ /usr/share/freeswitch/scripts/
COPY svbs-entrypoint.sh /svbs-entrypoint.sh

ENTRYPOINT ["/svbs-entrypoint.sh"]
