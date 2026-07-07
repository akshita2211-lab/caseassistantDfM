/* ═══════════════════════════════════════════════════════
   Case Assistant - DfM  |  Web App  |  app.js
   ═══════════════════════════════════════════════════════ */

const MAX_HISTORY = 10;
const IMG_MAX_W = 700;   // max width; height is always proportional
const STORAGE_KEY = 'dfm_history';

/* ── Image resize ────────────────────────────────────── */
function resizeImageDataUrl(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      // Only scale down if wider than MAX_W; never upscale
      const scale = img.width > IMG_MAX_W ? IMG_MAX_W / img.width : 1;
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.src = dataUrl;
  });
}

/* Resize all <img> elements inside an editor clone */
async function resizeEditorImages(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const imgs = Array.from(tmp.querySelectorAll('img'));
  for (const img of imgs) {
    const resized = await resizeImageDataUrl(img.src);
    img.src = resized;
    img.style.cssText = 'max-width:100%;height:auto;display:block;margin:4px 0;';
    img.removeAttribute('width');
    img.removeAttribute('height');
  }
  return tmp.innerHTML;
}

/* ── HTML / text helpers ─────────────────────────────── */
function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function getEditorHTML(el) { return el.innerHTML.trim(); }

function htmlToPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('img').forEach(img => img.replaceWith(document.createTextNode('[image]')));
  return tmp.textContent || '';
}

/* ── Word-wrap helper: insert <wbr> every 15 words in plain-text runs ── */
function wrapLongText(html) {
  // Only process text nodes inside the html, leave tags intact
  return html.replace(/>([\s\S]*?)</g, (match, text) => {
    if (!text.trim()) return match;
    const wrapped = text.split('\n').map(line => {
      const words = line.split(/(\s+)/);
      let count = 0;
      return words.map(chunk => {
        if (/\S/.test(chunk)) count++;
        if (count > 0 && count % 15 === 0 && /\S/.test(chunk)) return chunk + '<wbr>';
        return chunk;
      }).join('');
    }).join('\n');
    return '>' + wrapped + '<';
  });
}

function buildHTMLTable(rows) {
  const base = 'border:1px solid #ccc;padding:6px 10px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;max-width:600px;';
  const th = base + 'background:#f0f4fa;font-weight:700;white-space:nowrap;max-width:180px;';
  const td = base + 'white-space:pre-wrap;';
  let html = '<table style="border-collapse:collapse;table-layout:fixed;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:13px;">';
  for (const [label, content] of rows) {
    const safeContent = content ? wrapLongText(content) : '<em style="color:#aaa">—</em>';
    html += `<tr><td style="${th}">${escapeHtml(label)}</td><td style="${td}">${safeContent}</td></tr>`;
  }
  return html + '</table>';
}

/* ── Insert image into editor ────────────────────────── */
function insertImage(editor, dataUrl) {
  const img = document.createElement('img');
  img.src = dataUrl;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(img);
    range.setStartAfter(img);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(img);
  }
}

/* ── Error helpers ───────────────────────────────────── */
function setError(errId, wrapId, show) {
  const e = document.getElementById(errId);
  const w = wrapId ? document.getElementById(wrapId) : null;
  e.classList.toggle('hidden', !show);
  w && w.classList.toggle('error', show);
}

/* ── History (localStorage) ──────────────────────────── */
function loadHistory(cb) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cb(raw ? JSON.parse(raw) : []);
  } catch {
    cb([]);
  }
}
function saveHistory(list, cb) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('localStorage save failed:', err);
  }
  if (cb) cb();
}

/* ── Toast ───────────────────────────────────────────── */
function showToast(id, msg, isError = false) {
  const t = document.getElementById(id);
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error-toast' : '');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Element refs ── */
  const issueEl   = document.getElementById('issue');
  const actionEl  = document.getElementById('action');
  const planEl    = document.getElementById('actionplan');
  const selectEl  = document.getElementById('pendingSelect');
  const othersW   = document.getElementById('othersWrap');
  const othersEl  = document.getElementById('othersText');
  const dateEl    = document.getElementById('nextdate');

  // Business Impact refs
  const biUsers     = document.getElementById('bi-users');
  const biFinancial = document.getElementById('bi-financial');
  const biFinWrap   = document.getElementById('bi-financial-wrap');
  const biFinDetail = document.getElementById('bi-financial-detail');
  const biDeadline  = document.getElementById('bi-deadline');
  const biClient    = document.getElementById('bi-client');
  const biFirsttime = document.getElementById('bi-firsttime');
  const biComments  = document.getElementById('bi-comments');

  /* ── Views ── */
  function showView(id) {
    document.querySelectorAll('#tab1 .view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── History badge ── */
  function updateBadge(list) {
    const badge = document.getElementById('histBadge');
    badge.textContent = list.length;
    badge.classList.toggle('hidden', list.length === 0);
  }
  loadHistory(updateBadge);

  /* ── Attach-image buttons ── */
  document.querySelectorAll('.attach-btn').forEach(btn => {
    const target = btn.dataset.target;
    const fileIn = document.getElementById(`file-${target}`);
    const editor = document.getElementById(target);
    btn.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', () => {
      Array.from(fileIn.files).forEach(file => {
        const r = new FileReader();
        r.onload = e => insertImage(editor, e.target.result);
        r.readAsDataURL(file);
      });
      fileIn.value = '';
    });
  });

  /* ── Paste images (Issue, Action, Action Plan) ── */
  [issueEl, actionEl, planEl].forEach(editor => {
    editor.addEventListener('paste', e => {
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const r = new FileReader();
          r.onload = ev => insertImage(editor, ev.target.result);
          r.readAsDataURL(item.getAsFile());
        }
      }
    });
    editor.addEventListener('input', () => setError(`err-${editor.id}`, `wrap-${editor.id}`, false));
  });

  /* ── Date: plain text only ── */
  dateEl.addEventListener('paste', e => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
  });
  dateEl.addEventListener('input', () => setError('err-nextdate', 'wrap-nextdate', false));

  /* ── Dropdown: Others reveal ── */
  selectEl.addEventListener('change', () => {
    othersW.classList.toggle('hidden', selectEl.value !== 'Others');
    if (selectEl.value === 'Others') othersEl.focus();
    else { othersEl.value = ''; othersEl.classList.remove('error'); setError('err-others', null, false); }
    selectEl.classList.remove('error');
    setError('err-pending', null, false);
  });
  othersEl.addEventListener('input', () => { othersEl.classList.remove('error'); setError('err-others', null, false); });

  /* ── Financial Risk → show specify ── */
  biFinancial.addEventListener('change', () => {
    biFinWrap.classList.toggle('hidden', biFinancial.value !== 'Yes');
    if (biFinancial.value !== 'Yes') { biFinDetail.value = ''; biFinDetail.classList.remove('error'); setError('err-bi-financial-detail', null, false); }
    biFinancial.classList.remove('error'); setError('err-bi-financial', null, false);
  });
  [biUsers, biDeadline, biClient, biFirsttime].forEach(el => {
    el.addEventListener('change', () => { el.classList.remove('error'); setError(`err-bi-${el.id.replace('bi-','').replace('-','').replace('firsttime','firsttime')}`, null, false); });
  });

  /* ── Validation ── */
  function validate() {
    let ok = true;
    const issueEmpty = !issueEl.innerText.trim() && !issueEl.querySelector('img');
    setError('err-issue', 'wrap-issue', issueEmpty); if (issueEmpty) ok = false;

    const actionEmpty = !actionEl.innerText.trim() && !actionEl.querySelector('img');
    setError('err-action', 'wrap-action', actionEmpty); if (actionEmpty) ok = false;

    const pendEmpty = !selectEl.value;
    setError('err-pending', null, pendEmpty); selectEl.classList.toggle('error', pendEmpty); if (pendEmpty) ok = false;

    if (selectEl.value === 'Others' && !othersEl.value.trim()) {
      setError('err-others', null, true); othersEl.classList.add('error'); ok = false;
    }
    const dateEmpty = !dateEl.innerText.trim();
    setError('err-nextdate', 'wrap-nextdate', dateEmpty); if (dateEmpty) ok = false;

    // Financial Risk specify — only validate if Yes selected
    if (biFinancial.value === 'Yes' && !biFinDetail.value.trim()) {
      setError('err-bi-financial-detail', null, true); biFinDetail.classList.add('error'); ok = false;
    } else {
      setError('err-bi-financial-detail', null, false); biFinDetail.classList.remove('error');
    }

    return ok;
  }

  /* ── Collect current state ── */
  function currentState() {
    return {
      issue:    getEditorHTML(issueEl),
      action:   getEditorHTML(actionEl),
      plan:     getEditorHTML(planEl),
      pending:  selectEl.value,
      others:   othersEl.value.trim(),
      date:     dateEl.innerText.trim(),
      bi: {
        users:         biUsers.value,
        financial:     biFinancial.value,
        financialDetail: biFinDetail.value.trim(),
        deadline:      biDeadline.value,
        client:        biClient.value,
        firsttime:     biFirsttime.value,
        comments:      biComments.value.trim(),
      },
      savedAt:  new Date().toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    };
  }

  /* ── Pending label ── */
  function pendingLabel(s) {
    return s.pending === 'Others' && s.others ? `Others — ${s.others}` : s.pending;
  }

  /* ── Clear fields ── */
  function clearFields() {
    issueEl.innerHTML = ''; actionEl.innerHTML = ''; planEl.innerHTML = ''; dateEl.innerHTML = '';
    selectEl.value = ''; selectEl.classList.remove('error');
    othersW.classList.add('hidden'); othersEl.value = ''; othersEl.classList.remove('error');
    ['err-issue','err-action','err-pending','err-others','err-nextdate'].forEach(id => document.getElementById(id).classList.add('hidden'));
    ['wrap-issue','wrap-action','wrap-nextdate'].forEach(id => document.getElementById(id).classList.remove('error'));
    // Business Impact — reset to defaults
    biUsers.value = '≤10'; biFinancial.value = 'No'; biDeadline.value = 'No'; biClient.value = 'No'; biFirsttime.value = 'No';
    biFinDetail.value = ''; biComments.value = '';
    biFinWrap.classList.add('hidden');
    [biUsers, biFinancial, biDeadline, biClient, biFirsttime, biFinDetail].forEach(el => el.classList.remove('error'));
    ['err-bi-users','err-bi-financial','err-bi-deadline','err-bi-client','err-bi-firsttime','err-bi-financial-detail'].forEach(id => document.getElementById(id).classList.add('hidden'));
  }

  /* ── Restore state into fields ── */
  function restoreState(s) {
    issueEl.innerHTML  = s.issue  || '';
    actionEl.innerHTML = s.action || '';
    planEl.innerHTML   = s.plan   || '';
    selectEl.value     = s.pending || '';
    othersEl.value     = s.others  || '';
    dateEl.innerHTML   = s.date    || '';
    othersW.classList.toggle('hidden', s.pending !== 'Others');
    // Business Impact
    const bi = s.bi || {};
    biUsers.value     = bi.users     || '≤10';
    biFinancial.value = bi.financial || 'No';
    biFinDetail.value = bi.financialDetail || '';
    biDeadline.value  = bi.deadline  || 'No';
    biClient.value    = bi.client    || 'No';
    biFirsttime.value = bi.firsttime || 'No';
    biComments.value  = bi.comments  || '';
    biFinWrap.classList.toggle('hidden', (bi.financial || 'No') !== 'Yes');
  }

  /* ══ SAVE (explicit + dedupe across ALL fields — only merges on exact match) ══ */
  function entryKey(s) {
    const norm = (html) => htmlToPlainText(html || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const bi = s.bi || {};
    return [
      norm(s.issue),
      norm(s.action),
      norm(s.plan),
      (s.pending || '').trim().toLowerCase(),
      (s.others  || '').trim().toLowerCase(),
      (s.date    || '').trim().toLowerCase(),
      bi.users || '', bi.financial || '', bi.financialDetail || '',
      bi.deadline || '', bi.client || '', bi.firsttime || '', bi.comments || '',
    ].join('|||');
  }

  // Returns 'saved' | 'merged' | 'empty' via onDone(result)
  function saveCurrentToHistory(onDone) {
    const s = currentState();
    if (!s.issue && !s.action && !s.pending && !s.date) { if (onDone) onDone('empty'); return; }

    loadHistory(list => {
      const key = entryKey(s);
      const dupeIdx = list.findIndex(e => entryKey(e) === key);

      let merged = false;
      if (dupeIdx !== -1) {
        list = list.filter(e => entryKey(e) !== key);
        merged = true;
      }

      list.unshift(s);
      if (list.length > MAX_HISTORY) list = list.slice(0, MAX_HISTORY);

      saveHistory(list, () => {
        updateBadge(list);
        if (onDone) onDone(merged ? 'merged' : 'saved');
      });
    });
  }

  document.getElementById('btnSave').addEventListener('click', () => {
    saveCurrentToHistory(result => {
      if (result === 'merged') showToast('toast', '🔄 Similar entry found. Keeping the latest copy and deleting older entries.');
      else if (result === 'saved') showToast('toast', '✅ Saved to history!');
      else showToast('toast', 'Nothing to save.', true);
    });
  });

  /* ══ CLEAR ══ */
  document.getElementById('btnClear').addEventListener('click', () => {
    if (!confirm('Save to history and clear all fields?')) return;
    saveCurrentToHistory(result => {
      clearFields();
      if (result === 'merged') showToast('toast', '🔄 Similar entry found. Keeping the latest copy and deleting older entries.');
      else showToast('toast', '🗑️ Cleared. State saved to history.');
    });
  });

  /* ══ COPY TO CLIPBOARD ══ */
  document.getElementById('btnCopy').addEventListener('click', async () => {
    if (!validate()) return;
    const s = currentState();
    const issueResized  = await resizeEditorImages(s.issue);
    const actionResized = await resizeEditorImages(s.action);
    const planResized    = await resizeEditorImages(s.plan);
    const planEmpty = !htmlToPlainText(s.plan).trim() && !s.plan.includes('<img');

    const rows = [
      ['Issue',                    issueResized],
      ['Action Taken',             actionResized],
    ];
    // Business Impact — only include if user changed anything from defaults
    const bi = s.bi || {};
    const biIsDefault = (
      bi.users     === '≤10' &&
      bi.financial === 'No'  &&
      bi.deadline  === 'No'  &&
      bi.client    === 'No'  &&
      bi.firsttime === 'No'  &&
      !bi.financialDetail    &&
      !bi.comments
    );
    if (!biIsDefault) {
      const biSummary = [
        `Users Impacted: ${bi.users || '—'}`,
        `Financial Risk: ${bi.financial || '—'}${bi.financial === 'Yes' && bi.financialDetail ? ` (${bi.financialDetail})` : ''}`,
        `Deadline at Risk: ${bi.deadline || '—'}`,
        `Client Acquisition/Project Loss Risk: ${bi.client || '—'}`,
        `First Time Implementation: ${bi.firsttime || '—'}`,
        bi.comments ? `Comments: ${bi.comments}` : '',
      ].filter(Boolean).join('\n');
      rows.push(['Business Impact', escapeHtml(biSummary)]);
    }
    if (!planEmpty) rows.push(['Next Action / Action Plan', planResized]);
    rows.push(
      ['Next Action Pending On',   escapeHtml(pendingLabel(s))],
      ['Next Contact Date / Time', escapeHtml(s.date)],
    );
    const htmlTable = buildHTMLTable(rows);
    const plain = rows.map(([l, c]) => {
      const v = (l === 'Issue' || l === 'Action Taken' || l === 'Next Action / Action Plan') ? htmlToPlainText(c)
                : c.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      return `${l}\t${v || '—'}`;
    }).join('\n');

    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html':  new Blob([htmlTable], { type: 'text/html' }),
          'text/plain': new Blob([plain],     { type: 'text/plain' }),
        })]);
      } else {
        const ta = document.createElement('textarea');
        ta.value = plain; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      saveCurrentToHistory(result => {
        if (result === 'merged') showToast('toast', '✅ Copied. 🔄 Similar entry found — keeping latest in history.');
        else showToast('toast', '✅ Copied to clipboard!');
      });
    } catch (err) {
      console.error(err);
      showToast('toast', '❌ Copy failed. Try again.', true);
    }
  });

  /* ══ CREATE EMAIL ══ */
  document.getElementById('btnEmail').addEventListener('click', async () => {
    if (!validate()) return;
    const s = currentState();

    const issueHTML  = await resizeEditorImages(s.issue);
    const actionHTML = await resizeEditorImages(s.action);
    const planHTML    = await resizeEditorImages(s.plan);
    const planEmpty = !htmlToPlainText(s.plan).trim() && !s.plan.includes('<img');

    // Split an editor's HTML into interleaved text-blocks and image-blocks
    function buildSectionRows(html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;

      const rows = [];
      let textBuf = '';

      function flushText() {
        const t = textBuf.trim();
        if (t) rows.push({ type: 'text', html: textBuf });
        textBuf = '';
      }

      tmp.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          textBuf += node.textContent;
        } else if (node.nodeName === 'IMG') {
          flushText();
          rows.push({ type: 'img', src: node.src });
        } else if (node.nodeName === 'BR') {
          textBuf += '\n';
        } else {
          const innerImgs = node.querySelectorAll('img');
          if (innerImgs.length === 0) {
            textBuf += node.innerHTML || node.textContent;
          } else {
            flushText();
            node.childNodes.forEach(child => {
              if (child.nodeName === 'IMG') {
                flushText();
                rows.push({ type: 'img', src: child.src });
              } else {
                textBuf += child.textContent || '';
              }
            });
          }
        }
      });
      flushText();

      let out = '';
      for (const row of rows) {
        if (row.type === 'text') {
          const safe = row.html.replace(/\n/g, '<br>');
          out += `<div style="margin:0 0 6px 0;padding:6px 10px;background:#f5f6fa;border-left:3px solid #0f6cbd;font-size:13px;line-height:1.6;word-break:break-word">${safe}</div>`;
        } else {
          out += `<div style="margin:6px 0"><img src="${row.src}" style="max-width:100%;height:auto;display:block;border:1px solid #e0e0e0;border-radius:4px" /></div>`;
        }
      }
      return out || `<div style="padding:6px 10px;background:#f5f6fa;border-left:3px solid #0f6cbd;color:#aaa">—</div>`;
    }

    const issueParts  = buildSectionRows(issueHTML);
    const actionParts = buildSectionRows(actionHTML);
    const planParts    = buildSectionRows(planHTML);

    function humanise(html) {
      return html
        .replace(/\bCx\b/g, 'you')
        .replace(/\bcustomer\b/gi, 'you')
        .replace(/\bCustomer\b/g, 'You')
        .replace(/\bthe customer\b/gi, 'you')
        .replace(/\bThe customer\b/g, 'You')
        .replace(/\bclient\b/gi, 'you')
        .replace(/\bClient\b/g, 'You');
    }

    // Map "Next Action Pending On" → "Next Action Owner"
    function nextActionOwner(s) {
      switch (s.pending) {
        case 'CO':
        case 'Collab Owner':       return 'Microsoft Support';
        case 'PG':                 return 'Microsoft Product Group';
        case 'Cx':                 return 'You';
        case 'CSA':
        case 'Accounts Team':      return 'Microsoft Accounts Team';
        case 'Others':             return s.others || '—';
        default:                   return s.pending || '—';
      }
    }

    const label = (t) => `<p style="margin:0 0 4px 0;font-weight:700;font-size:13px;color:#1e1e2e;text-decoration:underline">${t}</p>`;
    const line  = (t) => `<p style="margin:0 0 8px 0;font-size:13px">${t}</p>`;
    const gap   = `<p style="margin:0;font-size:13px;line-height:1">&nbsp;</p>`;

    // Decide whether the date value is meaningful enough to show in the email.
    // Skip if empty, or clearly a "not applicable" type response.
    function isShowableDate(v) {
      const t = (v || '').trim();
      if (!t) return false;
      const skipWords = /^(na|n\/a|no|none|nil|not applicable|--*|—)$/i;
      return !skipWords.test(t);
    }
    const showDate = isShowableDate(s.date);
    const dateBlock = showDate ? `
${gap}
${label('Next Contact Date')}
${line(escapeHtml(s.date))}` : '';

    let bodyHTML;
    if (planEmpty) {
      // No Action Plan provided → Issue, Action Taken, (Next Contact Date if meaningful)
      bodyHTML = `
${label('Issue')}
${humanise(issueParts)}
${gap}
${label('Action Taken')}
${humanise(actionParts)}${dateBlock}`;
    } else {
      // Action Plan provided → Issue, Action Taken, Action Plan, Next Action Owner, (Next Contact Date if meaningful)
      bodyHTML = `
${label('Issue')}
${humanise(issueParts)}
${gap}
${label('Action Taken')}
${humanise(actionParts)}
${gap}
${label('Action Plan')}
${humanise(planParts)}
${gap}
${label('Next Action Owner')}
${line(escapeHtml(nextActionOwner(s)))}${dateBlock}`;
    }

    const emailHTML = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1e1e2e;line-height:1.6;max-width:680px">
${line('Hi,')}
${line('Hope you are doing well. Please find below a quick update on the case.')}
${bodyHTML}
${gap}
${line('Please feel free to reach out if you have any questions.')}
${line('Regards')}
</div>`.trim();

    const preview = document.getElementById('emailPreview');
    preview.innerHTML = emailHTML;
    preview._htmlContent = emailHTML;
    showView('viewEmail');
  });

  /* ══ COPY EMAIL ══ */
  document.getElementById('btnCopyEmail').addEventListener('click', async () => {
    const preview = document.getElementById('emailPreview');
    const htmlContent = preview._htmlContent || preview.innerHTML;
    const plainText   = htmlToPlainText(htmlContent);
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html':  new Blob([htmlContent], { type: 'text/html' }),
          'text/plain': new Blob([plainText],   { type: 'text/plain' }),
        })]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      showToast('toastEmail', '✅ Email copied!');
    } catch {
      showToast('toastEmail', '❌ Could not copy.', true);
    }
  });

  /* ══ HISTORY view ══ */
  document.getElementById('btnHistory').addEventListener('click', () => {
    document.getElementById('historySearch').value = '';
    renderHistory();
    showView('viewHistory');
  });
  document.getElementById('btnBackMain').addEventListener('click', () => showView('viewMain'));
  document.getElementById('btnBackEmail').addEventListener('click', () => showView('viewMain'));
  document.getElementById('btnBackEmail2').addEventListener('click', () => showView('viewMain'));

  /* ── Search input — live filter ── */
  document.getElementById('historySearch').addEventListener('input', renderHistory);

  /* ── Clear all history ── */
  document.getElementById('btnClearHistory').addEventListener('click', () => {
    if (!confirm('Clear all history?')) return;
    saveHistory([], () => {
      updateBadge([]);
      renderHistory();
    });
  });

  /* ── Render history cards ── */
  function renderHistory() {
    const query = (document.getElementById('historySearch').value || '').trim().toLowerCase();
    loadHistory(list => {
      const container = document.getElementById('historyList');
      container.innerHTML = '';

      // Filter by issue text if query is present
      const filtered = query
        ? list.filter(item => htmlToPlainText(item.issue || '').toLowerCase().includes(query))
        : list;

      if (list.length === 0) {
        container.innerHTML = '<div class="history-empty">No history yet.<br>Save or copy a note to see it here.</div>';
        return;
      }
      if (filtered.length === 0) {
        container.innerHTML = `<div class="history-empty">No results for "<strong>${escapeHtml(query)}</strong>".</div>`;
        return;
      }

      filtered.forEach((item, idx) => {
        // Use original index for deletion (so splice hits the right entry)
        const origIdx = list.indexOf(item);
        const card = document.createElement('div');
        card.className = 'history-card';

        const snippetIssue  = htmlToPlainText(item.issue  || '').slice(0, 70) || '—';
        const snippetAction = htmlToPlainText(item.action || '').slice(0, 70) || '—';
        const snippetPlan   = htmlToPlainText(item.plan   || '').slice(0, 70);
        const bi = item.bi || {};
        const biSnippet = bi.users ? `${bi.users} users · Financial: ${bi.financial || '—'} · Deadline: ${bi.deadline || '—'}` : '';

        // Highlight matched query in issue snippet
        function highlight(text) {
          if (!query) return escapeHtml(text);
          const idx = text.toLowerCase().indexOf(query);
          if (idx === -1) return escapeHtml(text);
          return escapeHtml(text.slice(0, idx))
            + `<mark style="background:#fff0a0;border-radius:2px">${escapeHtml(text.slice(idx, idx + query.length))}</mark>`
            + escapeHtml(text.slice(idx + query.length));
        }

        card.innerHTML = `
          <div class="history-card-header">
            <span class="history-card-time">${item.savedAt || ''}</span>
            <button class="history-card-del" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              </svg>
            </button>
          </div>
          <div class="history-card-body">
            <div class="history-row"><span class="history-label">Issue</span><span class="history-value">${highlight(snippetIssue)}${item.issue && item.issue.length > 70 ? '…' : ''}</span></div>
            ${biSnippet ? `<div class="history-row"><span class="history-label">Impact</span><span class="history-value">${escapeHtml(biSnippet)}</span></div>` : ''}
            <div class="history-row"><span class="history-label">Action</span><span class="history-value">${escapeHtml(snippetAction)}${item.action && item.action.length > 70 ? '…' : ''}</span></div>
            ${snippetPlan ? `<div class="history-row"><span class="history-label">Plan</span><span class="history-value">${escapeHtml(snippetPlan)}${item.plan && item.plan.length > 70 ? '…' : ''}</span></div>` : ''}
            <div class="history-row"><span class="history-label">Pending</span><span class="history-value">${escapeHtml(pendingLabel(item) || '—')}</span></div>
            <div class="history-row"><span class="history-label">Date</span><span class="history-value">${escapeHtml(item.date || '—')}</span></div>
          </div>`;

        card.querySelector('.history-card-body').addEventListener('click', () => {
          restoreState(item);
          showView('viewMain');
        });
        card.querySelector('.history-card-header').addEventListener('click', e => {
          if (!e.target.closest('.history-card-del')) {
            restoreState(item);
            showView('viewMain');
          }
        });

        card.querySelector('.history-card-del').addEventListener('click', e => {
          e.stopPropagation();
          loadHistory(l => {
            l.splice(origIdx, 1);
            saveHistory(l, () => { updateBadge(l); renderHistory(); });
          });
        });

        container.appendChild(card);
      });
    });
  }
});


/* ═══════════════════════════════════════════════════════
   TAB SWITCHING + INTERNAL TITLE GENERATOR
   ═══════════════════════════════════════════════════════ */

/* ── Tab switching ── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.classList.add('hidden'); });
    btn.classList.add('active');
    const tc = document.getElementById(tabId);
    tc.classList.remove('hidden');
    tc.classList.add('active');
  });
});

/* ═══════════════════════════════════════════════════════
   INTERNAL TITLE GENERATOR — Tab 2
   ═══════════════════════════════════════════════════════ */
(function() {
  const ITG_STORAGE_KEY = 'dfm_itg_history';
  const ITG_MAX = 10;

  /* ── Date helpers (system timezone) ── */
  function localDateStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    // Format as YYYY-MM-DD in LOCAL time (not UTC) for the date input
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Next weekday: Fri/Sat/Sun → Mon, otherwise tomorrow
  function nextWeekdayDateStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const dow = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
    if (dow === 5) d.setDate(d.getDate() + 3);      // Fri → Mon
    else if (dow === 6) d.setDate(d.getDate() + 2); // Sat → Mon
    else if (dow === 0) d.setDate(d.getDate() + 1); // Sun → Mon
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Format a YYYY-MM-DD string as MM/DD/YY
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${String(y).slice(2)}`;
  }

  /* ── Element refs ── */
  const lcEl       = document.getElementById('itg-lastContact');
  const ncEl       = document.getElementById('itg-nextContact');
  const statusEl   = document.getElementById('itg-status');
  const icmEl      = document.getElementById('itg-icm');
  const fqrEl      = document.getElementById('itg-fqr');
  const ftsEl      = document.getElementById('itg-fts');
  const sapEl      = document.getElementById('itg-sap');
  const commentsEl = document.getElementById('itg-comments');
  const preview    = document.getElementById('itg-preview');

  /* ── Set defaults ── */
  lcEl.value = localDateStr(0);   // today
  ncEl.value = nextWeekdayDateStr();   // next weekday

  /* ── Build the output string ── */
  function buildOutput() {
    const lc     = fmtDate(lcEl.value);
    const nc     = fmtDate(ncEl.value);
    const status = statusEl.value;
    const icm    = icmEl.value;
    const fqr    = fqrEl.value;
    const fts    = ftsEl.value;
    const sap    = sapEl.value;
    const comments = commentsEl.value.trim();
    const base = `LC: ${lc} | NC: ${nc} | Status: ${status} | IsFQR: ${fqr} | IsIcM: ${icm} | IsFTSfromotherregion: ${fts} | IsSAPCorrect: ${sap}`;
    return comments ? `${base} | Comments: ${comments}` : base;
  }

  /* ── Live preview ── */
  function updatePreview() {
    preview.textContent = buildOutput();
  }
  [lcEl, ncEl, statusEl, icmEl, fqrEl, ftsEl, sapEl].forEach(el =>
    el.addEventListener('change', updatePreview)
  );
  commentsEl.addEventListener('input', updatePreview);
  updatePreview(); // initial render

  /* ── Toast ── */
  function showToastITG(msg, isError = false) {
    const t = document.getElementById('itg-toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error-toast' : '');
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  /* ── History helpers ── */
  function itgLoadHistory(cb) {
    try { cb(JSON.parse(localStorage.getItem(ITG_STORAGE_KEY) || '[]')); }
    catch { cb([]); }
  }
  function itgSaveHistory(list, cb) {
    try { localStorage.setItem(ITG_STORAGE_KEY, JSON.stringify(list)); }
    catch(e) { console.error(e); }
    if (cb) cb();
  }

  function itgUpdateBadge(list) {
    const b = document.getElementById('itg-histBadge');
    b.textContent = list.length;
    b.classList.toggle('hidden', list.length === 0);
  }
  itgLoadHistory(itgUpdateBadge);

  /* ── Current state ── */
  function itgCurrentState() {
    return {
      lc:     lcEl.value,
      nc:     ncEl.value,
      status: statusEl.value,
      icm:      icmEl.value,
      fqr:      fqrEl.value,
      fts:      ftsEl.value,
      sap:      sapEl.value,
      comments: commentsEl.value.trim(),
      output: buildOutput(),
      savedAt: new Date().toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    };
  }

  /* ── Dedup key: all fields ── */
  function itgKey(s) {
    return [s.lc, s.nc, s.status, s.icm, s.fqr, s.fts, s.sap, (s.comments||'').toLowerCase()].join('|||');
  }

  /* ── Save with dedup ── */
  function itgSaveToHistory(onDone) {
    const s = itgCurrentState();
    itgLoadHistory(list => {
      const key = itgKey(s);
      const isDupe = list.some(e => itgKey(e) === key);
      let merged = false;
      if (isDupe) {
        list = list.filter(e => itgKey(e) !== key);
        merged = true;
      }
      list.unshift(s);
      if (list.length > ITG_MAX) list = list.slice(0, ITG_MAX);
      itgSaveHistory(list, () => {
        itgUpdateBadge(list);
        if (onDone) onDone(merged ? 'merged' : 'saved');
      });
    });
  }

  /* ── Restore state ── */
  function itgRestoreState(s) {
    lcEl.value     = s.lc     || localDateStr(0);
    ncEl.value     = s.nc     || nextWeekdayDateStr();
    statusEl.value = s.status || statusEl.options[0].value;
    icmEl.value    = s.icm    || 'No';
    fqrEl.value    = s.fqr    || 'Yes';
    ftsEl.value    = s.fts    || 'No';
    sapEl.value      = s.sap      || 'Yes';
    commentsEl.value = s.comments || '';
    updatePreview();
  }

  /* ── Reset to defaults ── */
  function itgClearFields() {
    lcEl.value     = localDateStr(0);
    ncEl.value     = nextWeekdayDateStr();
    statusEl.value = statusEl.options[0].value;
    icmEl.value    = 'No';
    fqrEl.value    = 'Yes';
    ftsEl.value    = 'No';
    sapEl.value      = 'Yes';
    commentsEl.value = '';
    updatePreview();
  }

  /* ── Views ── */
  function itgShowView(id) {
    document.querySelectorAll('#tab2 .view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  /* ── Copy ── */
  document.getElementById('itg-btnCopy').addEventListener('click', async () => {
    const text = buildOutput();
    try {
      await navigator.clipboard.writeText(text);
      itgSaveToHistory(result => {
        if (result === 'merged') showToastITG('✅ Copied. 🔄 Duplicate found — updated in history.');
        else showToastITG('✅ Copied to clipboard!');
      });
    } catch {
      showToastITG('❌ Copy failed. Try again.', true);
    }
  });

  /* ── Save ── */
  document.getElementById('itg-btnSave').addEventListener('click', () => {
    itgSaveToHistory(result => {
      if (result === 'merged') showToastITG('🔄 Duplicate found. Keeping the latest entry.');
      else showToastITG('✅ Saved to history!');
    });
  });

  /* ── Clear ── */
  document.getElementById('itg-btnClear').addEventListener('click', () => {
    if (!confirm('Save to history and reset all fields?')) return;
    itgSaveToHistory(result => {
      itgClearFields();
      if (result === 'merged') showToastITG('🔄 Duplicate found. Keeping the latest entry.');
      else showToastITG('🗑️ Cleared. State saved to history.');
    });
  });

  /* ── History ── */
  document.getElementById('itg-btnHistory').addEventListener('click', () => {
    itgRenderHistory();
    itgShowView('itg-viewHistory');
  });
  document.getElementById('itg-btnBackMain').addEventListener('click', () => itgShowView('itg-viewMain'));

  document.getElementById('itg-btnClearHistory').addEventListener('click', () => {
    if (!confirm('Clear all ITG history?')) return;
    itgSaveHistory([], () => { itgUpdateBadge([]); itgRenderHistory(); });
  });

  function itgRenderHistory() {
    itgLoadHistory(list => {
      const container = document.getElementById('itg-historyList');
      container.innerHTML = '';
      if (list.length === 0) {
        container.innerHTML = '<div class="history-empty">No history yet.<br>Copy or Save an entry to see it here.</div>';
        return;
      }
      list.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
          <div class="history-card-header">
            <span class="history-card-time">${item.savedAt || ''}</span>
            <button class="history-card-del" data-idx="${idx}" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </div>
          <div class="history-card-body">
            <div class="history-row"><span class="history-label">LC</span><span class="history-value">${fmtDate(item.lc)}</span></div>
            <div class="history-row"><span class="history-label">NC</span><span class="history-value">${fmtDate(item.nc)}</span></div>
            <div class="history-row"><span class="history-label">Status</span><span class="history-value">${item.status || '—'}</span></div>
            <div class="history-row"><span class="history-label">Output</span><span class="history-value" style="white-space:normal;font-size:11px;font-family:monospace">${item.output || '—'}</span></div>
            ${item.comments ? `<div class="history-row"><span class="history-label">Comments</span><span class="history-value">${item.comments}</span></div>` : ''}
          </div>`;

        const restore = () => { itgRestoreState(item); itgShowView('itg-viewMain'); };
        card.querySelector('.history-card-body').addEventListener('click', restore);
        card.querySelector('.history-card-header').addEventListener('click', e => {
          if (!e.target.closest('.history-card-del')) restore();
        });
        card.querySelector('.history-card-del').addEventListener('click', e => {
          e.stopPropagation();
          itgLoadHistory(l => {
            l.splice(idx, 1);
            itgSaveHistory(l, () => { itgUpdateBadge(l); itgRenderHistory(); });
          });
        });
        container.appendChild(card);
      });
    });
  }

})();
