import { buildDirectoryXml, USER_CONTEXT } from './directory-xml.js';

describe('buildDirectoryXml', () => {
  const xml = buildDirectoryXml('10.0.0.1', {
    extension: '20001',
    password: 'p"<&>',
    name: '이장님',
    role: 'admin',
  });

  it('includes user, password and svbs context', () => {
    expect(xml).toContain('<domain name="10.0.0.1">');
    expect(xml).toContain('<user id="20001">');
    expect(xml).toContain(`name="user_context" value="${USER_CONTEXT}"`);
    expect(xml).toContain('name="svbs_role" value="admin"');
  });

  it('escapes XML special characters', () => {
    expect(xml).toContain('value="p&quot;&lt;&amp;&gt;"');
  });
});
