// Email content. Every email is built from the couple's saved wedding details; the
// same builders power the "preview" button, so couples see exactly what guests get.

import { esc, coupleNames, formatDate, formatTime } from '../../shared/render.js';

// Workflows that carry information a guest needs for the wedding itself. Non-essential
// ones (newsletters and updates) are only sent to guests who opted in.
export const WORKFLOWS = {
  rsvp_confirmation: { name: 'RSVP confirmation', essential: true, trigger: 'When a guest submits an RSVP', scheduled: false },
  invitation: { name: 'Invitation email', essential: true, trigger: 'When you send invitations from the guest list', scheduled: false },
  rsvp_reminder: { name: 'RSVP reminder', essential: true, trigger: 'Before your RSVP deadline, to guests who have not replied', scheduled: true },
  biweekly_update: { name: 'Biweekly wedding update', essential: false, trigger: 'Every two weeks until the wedding, to guests who opted in', scheduled: true },
  final_reminders: { name: 'Final reminders', essential: true, trigger: 'Shortly before the wedding, to guests who are attending', scheduled: true },
  update_notification: { name: 'Wedding update notification', essential: false, trigger: 'When you publish an important update, to guests who opted in', scheduled: false }
};

export const DEFAULT_RULE_CONFIG = {
  rsvp_confirmation: { message: '' },
  invitation: { message: 'We would love for you to celebrate with us.' },
  rsvp_reminder: { days_before_deadline: [14, 3], send_hour: 10, message: '' },
  biweekly_update: { start_date: '', send_hour: 10, subject: 'Wedding update', message: 'Here is what is new as we get ready for the big day.' },
  final_reminders: { days_before: [7, 1], send_hour: 10, message: 'We cannot wait to see you!' },
  update_notification: {}
};

function layout({ palette, preheader, title, bodyHtml, button, footerHtml, platformName }) {
  const primary = palette?.primary || '#7b5c4f';
  const bg = '#f6f3ef';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:${bg};font-family:Georgia,'Times New Roman',serif;color:#2a2523">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader || '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="height:6px;background:${esc(primary)}"></td></tr>
<tr><td style="padding:36px 32px 8px"><h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;color:#2a2523;font-weight:normal">${esc(title)}</h1>
<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#3d3735">${bodyHtml}</div></td></tr>
${button ? `<tr><td style="padding:12px 32px 32px"><a href="${esc(button.url)}" style="display:inline-block;background:${esc(primary)};color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:6px;font-family:Helvetica,Arial,sans-serif;font-weight:bold">${esc(button.label)}</a></td></tr>` : ''}
</table>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8a817c;max-width:560px;line-height:1.5;margin:18px auto 0">${footerHtml || ''}${footerHtml ? '<br>' : ''}Sent with ${esc(platformName || 'Vowly')}</p>
</td></tr></table></body></html>`;
}

const p = (text) => String(text || '').trim() ? String(text).trim().split(/\n{2,}/).map((x) => `<p style="margin:0 0 14px">${esc(x).replace(/\n/g, '<br>')}</p>`).join('') : '';

function textVersion(lines) {
  return lines.filter((l) => l !== null && l !== undefined && l !== '').join('\n\n');
}

function eventsSummary(events, locale) {
  return (events || []).map((e) => {
    const when = [e.date ? formatDate(e.date, locale) : '', formatTime(e.start_time, locale)].filter(Boolean).join(', ');
    return { html: `<li style="margin-bottom:8px"><strong>${esc(e.name)}</strong>${when ? ` — ${esc(when)}` : ''}${e.venue ? `<br>${esc(e.venue)}` : ''}</li>`, text: `• ${e.name}${when ? ` — ${when}` : ''}${e.venue ? ` (${e.venue})` : ''}` };
  });
}

function guestFooter(ctx, essential) {
  if (!ctx.unsubscribeUrl) return { html: '', text: '' };
  const label = essential ? 'Manage email preferences' : 'Unsubscribe from wedding updates';
  return {
    html: `You are receiving this because you are on the guest list for ${esc(coupleNames(ctx.wedding))}'s wedding. <a href="${esc(ctx.unsubscribeUrl)}" style="color:#8a817c">${label}</a>.`,
    text: `${label}: ${ctx.unsubscribeUrl}`
  };
}

// ctx: { wedding, palette, siteUrl, guest, events, config(rule config), payload, unsubscribeUrl, platformName, rsvp }
export function buildGuestEmail(type, ctx) {
  const w = ctx.wedding;
  const names = coupleNames(w);
  const locale = w.locale || 'en-GB';
  const date = w.wedding_date_local ? formatDate(w.wedding_date_local, locale) : '';
  const first = ctx.guest?.first_name || ctx.rsvp?.name?.split(' ')[0] || 'there';
  const cfg = ctx.config || {};
  const essential = WORKFLOWS[type]?.essential ?? true;
  const footer = guestFooter(ctx, essential);
  const inviteUrl = ctx.guest?.invite_code ? `${ctx.siteUrl}?invite=${encodeURIComponent(ctx.guest.invite_code)}#rsvp` : `${ctx.siteUrl}#rsvp`;
  const ev = eventsSummary(ctx.events, locale);
  let subject, title, body, text, button;

  switch (type) {
    case 'rsvp_confirmation': {
      const r = ctx.rsvp || {};
      const attending = r.attending === 'yes';
      subject = `Your RSVP for ${names}'s wedding`;
      title = attending ? `Thank you, ${first}! We can't wait to celebrate with you.` : `Thank you for letting us know, ${first}.`;
      const chosen = attending ? eventsSummary((ctx.events || []).filter((e) => (r.events || []).includes(e.id)), locale) : [];
      body = `${p(attending ? `Your RSVP for ${names}'s wedding on ${date} is confirmed.` : `We're sorry you can't make it to ${names}'s wedding — you'll be missed.`)}
        ${chosen.length ? `<p style="margin:0 0 8px">You're down for:</p><ul style="padding-left:18px;margin:0 0 14px">${chosen.map((x) => x.html).join('')}</ul>` : ''}
        ${r.plus_one_name ? p(`Plus-one: ${r.plus_one_name}`) : ''}
        ${p(cfg.message)}${p('Need to change something? Use the button below and submit the form again — your latest response is the one we keep.')}`;
      text = textVersion([title, attending ? `Your RSVP for ${names}'s wedding on ${date} is confirmed.` : `We're sorry you can't make it to ${names}'s wedding.`, chosen.map((x) => x.text).join('\n'), r.plus_one_name ? `Plus-one: ${r.plus_one_name}` : '', cfg.message, `Change your response: ${inviteUrl}`, footer.text]);
      button = { label: 'View the wedding website', url: inviteUrl };
      break;
    }
    case 'invitation': {
      subject = `You're invited: ${names}${date ? ` · ${date}` : ''}`;
      title = `${names} are getting married!`;
      body = `${p(`Dear ${first},`)}${p(cfg.message)}${date ? p(`${date}${w.location ? ` · ${w.location}` : ''}`) : ''}
        ${ev.length ? `<ul style="padding-left:18px;margin:0 0 14px">${ev.map((x) => x.html).join('')}</ul>` : ''}
        ${p('Everything you need — the schedule, travel details and the RSVP form — is on our wedding website.')}
        ${ctx.guest?.invite_code ? p(`Your invitation code: ${ctx.guest.invite_code}`) : ''}`;
      text = textVersion([`Dear ${first},`, cfg.message, date ? `${date}${w.location ? ` · ${w.location}` : ''}` : '', ev.map((x) => x.text).join('\n'), `RSVP and details: ${inviteUrl}`, ctx.guest?.invite_code ? `Your invitation code: ${ctx.guest.invite_code}` : '', footer.text]);
      button = { label: 'View invitation & RSVP', url: inviteUrl };
      break;
    }
    case 'rsvp_reminder': {
      const deadline = w.rsvp_deadline ? formatDate(w.rsvp_deadline, locale) : '';
      subject = `Reminder: please RSVP${deadline ? ` by ${deadline}` : ''}`;
      title = `We'd love to know if you can come, ${first}`;
      body = `${p(`${names} are finalising plans for ${date ? `their wedding on ${date}` : 'their wedding'}${deadline ? ` and would love your response by ${deadline}` : ''}.`)}${p(cfg.message)}`;
      text = textVersion([title, `${names} would love your response${deadline ? ` by ${deadline}` : ''}.`, cfg.message, `RSVP: ${inviteUrl}`, footer.text]);
      button = { label: 'RSVP now', url: inviteUrl };
      break;
    }
    case 'biweekly_update': {
      const days = ctx.payload?.days_to_go;
      subject = cfg.subject || `Wedding update from ${names}`;
      title = days ? `${days} days to go!` : `An update from ${names}`;
      body = `${p(`Hi ${first},`)}${p(cfg.message)}`;
      text = textVersion([title, `Hi ${first},`, cfg.message, `Wedding website: ${ctx.siteUrl}`, footer.text]);
      button = { label: 'Visit the wedding website', url: ctx.siteUrl };
      break;
    }
    case 'final_reminders': {
      const days = ctx.payload?.days_before;
      subject = days === 1 ? `Tomorrow: ${names}'s wedding` : `${days} days until ${names}'s wedding`;
      title = days === 1 ? 'See you tomorrow!' : `Just ${days} days to go`;
      body = `${p(`Hi ${first},`)}${p(cfg.message)}${ev.length ? `<ul style="padding-left:18px;margin:0 0 14px">${ev.map((x) => x.html).join('')}</ul>` : ''}${p('Check the website for directions, the schedule and any last-minute updates.')}`;
      text = textVersion([title, `Hi ${first},`, cfg.message, ev.map((x) => x.text).join('\n'), `Details: ${ctx.siteUrl}`, footer.text]);
      button = { label: 'Wedding details', url: ctx.siteUrl };
      break;
    }
    case 'update_notification': {
      subject = ctx.payload?.subject || `An update from ${names}`;
      title = ctx.payload?.subject || `An update from ${names}`;
      body = `${p(`Hi ${first},`)}${p(ctx.payload?.message || 'We have updated our wedding website with new information.')}`;
      text = textVersion([title, `Hi ${first},`, ctx.payload?.message, `See what's new: ${ctx.siteUrl}`, footer.text]);
      button = { label: "See what's new", url: ctx.siteUrl };
      break;
    }
    default:
      throw new Error(`Unknown email type ${type}`);
  }
  return {
    subject, essential, text,
    html: layout({ palette: ctx.palette, preheader: subject, title, bodyHtml: body, button, footerHtml: footer.html, platformName: ctx.platformName })
  };
}

export function buildAccountEmail(type, ctx) {
  const { platformName, url } = ctx;
  if (type === 'verify_email') {
    return {
      subject: `Confirm your email for ${platformName}`,
      text: `Confirm your email address: ${url}\n\nThis link expires in 48 hours.`,
      html: layout({ title: 'Confirm your email address', bodyHtml: p(`Welcome to ${platformName}! Confirm your email so you can publish your website and receive RSVP notifications. This link expires in 48 hours.`), button: { label: 'Confirm email', url }, platformName })
    };
  }
  if (type === 'reset_password') {
    return {
      subject: `Reset your ${platformName} password`,
      text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you didn't ask for this, ignore this email.`,
      html: layout({ title: 'Reset your password', bodyHtml: p("Someone asked to reset your password. If that was you, use the button below — the link expires in 1 hour. If it wasn't, you can ignore this email."), button: { label: 'Choose a new password', url }, platformName })
    };
  }
  if (type === 'coowner_invite') {
    return {
      subject: `${ctx.inviter} invited you to edit ${ctx.names}'s wedding website`,
      text: `${ctx.inviter} invited you to collaborate on ${ctx.names}'s wedding website on ${platformName}.\n\nAccept: ${url}`,
      html: layout({ title: 'You have been invited to collaborate', bodyHtml: p(`${ctx.inviter} invited you to help with ${ctx.names}'s wedding website on ${platformName}. Sign in or create an account with this email address to accept.`), button: { label: 'Accept invitation', url }, platformName })
    };
  }
  throw new Error(`Unknown account email ${type}`);
}
