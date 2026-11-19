/** mod_xml_curl 디렉터리 응답 XML 생성 */

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const NOT_FOUND_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
  '<document type="freeswitch/xml">\n' +
  '  <section name="result">\n' +
  '    <result status="not found"/>\n' +
  '  </section>\n' +
  '</document>\n';

export interface DirectoryUser {
  extension: string;
  password: string;
  name: string;
  role: string;
}

/** 모든 사용자는 'svbs' dialplan context 로 들어온다 */
export const USER_CONTEXT = 'svbs';

const DIAL_STRING =
  '{^^:sip_invite_domain=${dialed_domain}:presence_id=${dialed_user}@${dialed_domain}}' +
  '${sofia_contact(*/${dialed_user}@${dialed_domain})}';

export function buildDirectoryXml(domain: string, user: DirectoryUser): string {
  const vars: Record<string, string> = {
    user_context: USER_CONTEXT,
    effective_caller_id_name: user.name,
    effective_caller_id_number: user.extension,
    svbs_extension: user.extension,
    svbs_role: user.role,
  };
  const variables = Object.entries(vars)
    .map(
      ([k, v]) =>
        `          <variable name="${escapeXml(k)}" value="${escapeXml(v)}"/>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="directory">
    <domain name="${escapeXml(domain)}">
      <params>
        <param name="dial-string" value="${escapeXml(DIAL_STRING)}"/>
      </params>
      <user id="${escapeXml(user.extension)}">
        <params>
          <param name="password" value="${escapeXml(user.password)}"/>
        </params>
        <variables>
${variables}
        </variables>
      </user>
    </domain>
  </section>
</document>
`;
}
