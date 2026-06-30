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

function buildHTMLTable(rows) {
  const base = 'border:1px solid #ccc;padding:6px 10px;vertical-align:top;word-break:break-word;';
  const th = base + 'background:#f0f4fa;font-weight:700;white-space:nowrap;';
  const td = base + 'white-space:pre-wrap;';
  let html = '<table style="border-collapse:collapse;table-layout:auto;font-family:Segoe UI,Arial,sans-serif;font-size:13px;">';
  for (const [label, content] of rows) {
    html += `<tr><td style="${th}">${escapeHtml(label)}</td><td style="${td}">${content || '<em style="color:#aaa">—</em>'}</td></tr>`;
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

  /* ── Views ── */
  function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
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
  }

  /* ══ SAVE (explicit + dedupe by Issue text) ══ */
  function issueKey(s) {
    return htmlToPlainText(s.issue || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Returns 'saved' | 'merged' | 'empty' via onDone(result)
  function saveCurrentToHistory(onDone) {
    const s = currentState();
    if (!s.issue && !s.action && !s.pending && !s.date) { if (onDone) onDone('empty'); return; }

    loadHistory(list => {
      const key = issueKey(s);
      const dupeIdx = key ? list.findIndex(e => issueKey(e) === key) : -1;

      let merged = false;
      if (dupeIdx !== -1) {
        list = list.filter(e => issueKey(e) !== key);
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

    let bodyHTML;
    if (planEmpty) {
      // No Action Plan provided → Issue, Action Taken, Next Contact Date
      bodyHTML = `
${label('Issue')}
${humanise(issueParts)}
${gap}
${label('Action Taken')}
${humanise(actionParts)}
${gap}
${label('Next Contact Date')}
${line(escapeHtml(s.date))}`;
    } else {
      // Action Plan provided → Issue, Action Taken, Action Plan, Next Action Owner
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
${line(escapeHtml(nextActionOwner(s)))}`;
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
    renderHistory();
    showView('viewHistory');
  });
  document.getElementById('btnBackMain').addEventListener('click', () => showView('viewMain'));
  document.getElementById('btnBackEmail').addEventListener('click', () => showView('viewMain'));
  document.getElementById('btnBackEmail2').addEventListener('click', () => showView('viewMain'));

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
    loadHistory(list => {
      const container = document.getElementById('historyList');
      container.innerHTML = '';
      if (list.length === 0) {
        container.innerHTML = '<div class="history-empty">No history yet.<br>Save or copy a note to see it here.</div>';
        return;
      }
      list.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'history-card';

        const snippetIssue  = htmlToPlainText(item.issue  || '').slice(0, 70) || '—';
        const snippetAction = htmlToPlainText(item.action || '').slice(0, 70) || '—';
        const snippetPlan   = htmlToPlainText(item.plan   || '').slice(0, 70);

        card.innerHTML = `
          <div class="history-card-header">
            <span class="history-card-time">${item.savedAt || ''}</span>
            <button class="history-card-del" data-idx="${idx}" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              </svg>
            </button>
          </div>
          <div class="history-card-body">
            <div class="history-row"><span class="history-label">Issue</span><span class="history-value">${escapeHtml(snippetIssue)}${item.issue && item.issue.length > 70 ? '…' : ''}</span></div>
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
            l.splice(idx, 1);
            saveHistory(l, () => { updateBadge(l); renderHistory(); });
          });
        });

        container.appendChild(card);
      });
    });
  }
});
