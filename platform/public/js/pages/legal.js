import { $, $$, publicChrome, publicFooter } from '../api.js';

const { config } = await publicChrome();
$('#footer').innerHTML = publicFooter(config.platform_name, config.support_email);
$$('[data-support-link]').forEach((a) => { a.href = `mailto:${config.support_email}`; a.textContent = config.support_email; });
