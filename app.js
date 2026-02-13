document.addEventListener('DOMContentLoaded', () => {
    const STORAGE_KEY = 'registrationAppData';
    const WAAR_MAP_KEY    = 'registrationAppWaarMap';
    const WAAR_REVIEW_KEY = 'registrationAppWaarReview';
    const REG_PREFIX = '460265';
    const WO_PREFIX = '460260';

    // DOM elements
    const tableBody = document.getElementById('tableBody');
    const addRowBtn = document.getElementById('addRowBtn');
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const recordForm = document.getElementById('recordForm');
    const cancelBtn = document.getElementById('cancelBtn');
    const rowCount = document.getElementById('rowCount');
    const modalOverlay = modal.querySelector('.modal-overlay');

    // Waar confirmation dialog elements
    const waarConfirmDialog = document.getElementById('waarConfirmDialog');
    const waarConfirmMsg    = document.getElementById('waarConfirmMsg');
    const waarConfirmJa     = document.getElementById('waarConfirmJa');
    const waarConfirmNee    = document.getElementById('waarConfirmNee');

    let records = loadRecords();
    let waarMappings    = loadWaarMappings();
    let waarNeedsReview = loadWaarNeedsReview();
    let editingId = null;
    let pendingWaarEdit = null; // { el, original, newValue } while confirmation dialog is open

    // Sort & filter state
    let sortKey = null;
    let sortDir = 0; // 0 = none, 1 = asc, -1 = desc
    let filters = {};

    // Expand/collapse state – tracks which regNummers are expanded
    const expandedGroups = new Set();

    // Flag to suppress sort when a column resize just happened
    let resizing = false;

    // Inline editing option lists
    const MONTEUR_OPTIONS = ['', 'Amadeusz', 'Devin', 'Dimitri', 'Dylan', 'Ferry', 'Jayden', 'Johan', 'Kevin', 'Koen', 'Leendert', 'Michel', 'Mohammed', 'Richaino', 'Robert-Jan', 'Rowan', 'Storm', 'Tomasz', 'Willem', 'Yoni'];
    const UITGEVOERD_OPTIONS = ['Nee', 'Bezig', 'Ja', 'Vervallen'];
    const AFGEMELD_OPTIONS = ['Nee', 'Ja'];
    const REFERENTIE_OPTIONS = ['Nee', 'Ingevuld', 'Ja', 'Onnodig'];
    const ARCHIEF_OPTIONS = ['Ja', 'Onvolledig', 'Nee'];
    const VERVOLG_OPTIONS = ['Nee', 'Gepland', 'Ja', 'Onbekend'];

    // Priority rankings for status fields (lower index = worse)
    const STATUS_RANK = {
        uitgevoerd:    ['Nee', 'Bezig', 'Ja', 'Vervallen'],
        afgemeld:      ['Nee', 'Ja'],
        referentie:    ['Nee', 'Ingevuld', 'Ja', 'Onnodig'],
        archiefGevuld: ['Nee', 'Onvolledig', 'Ja'],
        vervolg:       ['Ja', 'Onbekend', 'Gepland', 'Nee'],
    };

    // Return the worst (lowest-ranked) value across records for a status field
    function worstValue(field, recs) {
        const rank = STATUS_RANK[field];
        if (!rank) return recs[0][field] || '';
        let worstIdx = rank.length;
        let worstVal = '';
        recs.forEach(r => {
            const v = r[field] || '';
            const idx = rank.indexOf(v);
            if (idx !== -1 && idx < worstIdx) {
                worstIdx = idx;
                worstVal = v;
            }
        });
        return worstVal || recs[0][field] || '';
    }

    // Build a summary object for a group's collapsed row (worst status values)
    function groupSummary(recs) {
        return {
            uitgevoerd:    worstValue('uitgevoerd', recs),
            afgemeld:      worstValue('afgemeld', recs),
            referentie:    worstValue('referentie', recs),
            archiefGevuld: worstValue('archiefGevuld', recs),
            vervolg:       worstValue('vervolg', recs),
        };
    }

    // Cascade rules triggered by an Afg. change:
    //   Afg. = Ja  → Uitg. = Ja (unless Uitg. is already Vervallen)
    //   Afg. = Nee → Vervolg = Onbekend
    function applyAfgemeldRules(record) {
        if (record.afgemeld === 'Ja') {
            if (record.uitgevoerd !== 'Vervallen') record.uitgevoerd = 'Ja';
        } else if (record.afgemeld === 'Nee') {
            record.vervolg = 'Onbekend';
        }
    }

    // Calculate score based on field values
    function calculateScore(record) {
        let score = 0;
        if (record.uitgevoerd === 'Ja' || record.uitgevoerd === 'Vervallen') score++;
        if (record.afgemeld === 'Ja') score++;
        if (record.referentie === 'Ja' || record.referentie === 'Onnodig') score++;
        if (record.archiefGevuld === 'Ja') score++;
        if (record.vervolg === 'Nee' || record.vervolg === 'Gepland') score++;
        return score;
    }

    // Return CSS class for a status cell based on field and value
    function statusColor(field, value) {
        const rules = {
            uitgevoerd:   { green: ['Ja', 'Vervallen'], yellow: ['Bezig'], red: ['Nee'] },
            afgemeld:     { green: ['Ja'], red: ['Nee'] },
            referentie:   { green: ['Ja', 'Onnodig'], yellow: ['Ingevuld'], red: ['Nee'] },
            archiefGevuld:{ green: ['Ja'], yellow: ['Onvolledig'], red: ['Nee'] },
            vervolg:      { green: ['Nee', 'Gepland'], yellow: ['Onbekend'], red: ['Ja'] },
        };
        const r = rules[field];
        if (!r) return '';
        if (r.green  && r.green.includes(value))  return 'cell-green';
        if (r.yellow && r.yellow.includes(value)) return 'cell-yellow';
        if (r.red    && r.red.includes(value))    return 'cell-red';
        return '';
    }

    // Load records from localStorage, seed with INITIAL_DATA on first run.
    // Always strips records with datumAanvang before 2026 and persists the result.
    function loadRecords() {
        let data;
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            data = JSON.parse(stored);
        } else if (typeof INITIAL_DATA !== 'undefined' && INITIAL_DATA.length > 0) {
            data = [...INITIAL_DATA];
        } else {
            return [];
        }
        const dateOk = data.filter(r => !r.datumAanvang || r.datumAanvang >= '2026-01-01');
        // Drop reg. nr. groups where every WO-nr has an empty datumAanvang.
        const regHasDate = new Set(
            dateOk.filter(r => r.datumAanvang).map(r => r.regNummer)
        );
        const filtered = dateOk.filter(r => regHasDate.has(r.regNummer));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        return filtered;
    }

    // Save records to localStorage
    function saveRecords() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    }

    // Load/save "Waar" correction mappings (original → corrected)
    function loadWaarMappings() {
        try { return JSON.parse(localStorage.getItem(WAAR_MAP_KEY) || '{}'); }
        catch (e) { return {}; }
    }
    function saveWaarMappings() {
        localStorage.setItem(WAAR_MAP_KEY, JSON.stringify(waarMappings));
    }
    function loadWaarNeedsReview() {
        try { return new Set(JSON.parse(localStorage.getItem(WAAR_REVIEW_KEY) || '[]')); }
        catch (e) { return new Set(); }
    }
    function saveWaarNeedsReview() {
        localStorage.setItem(WAAR_REVIEW_KEY, JSON.stringify([...waarNeedsReview]));
    }

    // Format date for display (YYYY-MM-DD → DD-MM-YYYY)
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    // Parse display date (DD-MM-YYYY → YYYY-MM-DD); passes through ISO strings unchanged
    function parseDisplayDate(s) {
        if (!s) return '';
        const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        return '';
    }

    // Apply filters and sorting to records
    function getFilteredSorted() {
        let result = records.filter(record => {
            for (const key in filters) {
                const val = filters[key];
                if (!val) continue;
                if (key === 'regFilter') {
                    const reg = record.regNummer || '';
                    const rangeMatch = val.match(/^(20\d{2})-(20\d{2})$/);
                    if (rangeMatch) {
                        const y1 = parseInt(rangeMatch[1], 10);
                        const y2 = parseInt(rangeMatch[2], 10);
                        const ys = reg.slice(3, 5);
                        const ry = ys ? 2000 + parseInt(ys, 10) : 0;
                        if (ry < y1 || ry > y2) return false;
                    } else if (/^20\d{2}$/.test(val)) {
                        if (reg.slice(3, 5) !== val.slice(2)) return false;
                    } else {
                        if (!reg.toLowerCase().includes(val.toLowerCase())) return false;
                    }
                    continue;
                }
                if (key === 'aanvangFilter') {
                    const lc = val.toLowerCase();
                    let mode = '';
                    let datePart = val.trim();
                    if (lc.startsWith('na '))     { mode = 'na';    datePart = val.slice(3).trim(); }
                    else if (lc.startsWith('voor '))  { mode = 'voor';  datePart = val.slice(5).trim(); }
                    else if (lc.startsWith('vanaf ')) { mode = 'vanaf'; datePart = val.slice(6).trim(); }
                    else if (lc.startsWith('t/m '))   { mode = 'tm';    datePart = val.slice(4).trim(); }
                    datePart = datePart.replace(/\//g, '-');
                    let startISO, endISO;
                    const yearM    = datePart.match(/^(\d{4})$/);
                    const monthM   = datePart.match(/^(\d{2})-(\d{4})$/);
                    const fullM    = datePart.match(/^(\d{2})-(\d{2})-(\d{4})$/);
                    if (yearM) {
                        startISO = `${datePart}-01-01`;
                        endISO   = `${datePart}-12-31`;
                    } else if (monthM) {
                        const [, mm, yyyy] = monthM;
                        const lastDay = new Date(parseInt(yyyy, 10), parseInt(mm, 10), 0).getDate();
                        startISO = `${yyyy}-${mm}-01`;
                        endISO   = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
                    } else if (fullM) {
                        const [, dd, mm, yyyy] = fullM;
                        startISO = endISO = `${yyyy}-${mm}-${dd}`;
                    } else {
                        continue; // unrecognized format → don't filter
                    }
                    const d = record.datumAanvang || '';
                    if (!d) return false;
                    if      (mode === '')      { if (d < startISO || d > endISO) return false; }
                    else if (mode === 'voor')  { if (d >= startISO) return false; }
                    else if (mode === 'tm')    { if (d > endISO)    return false; }
                    else if (mode === 'vanaf') { if (d < startISO)  return false; }
                    else if (mode === 'na')    { if (d <= endISO)   return false; }
                    continue;
                }
                const field = (record[key] || '').toLowerCase();
                if (key === 'uitgevoerd' || key === 'afgemeld' || key === 'referentie' || key === 'archiefGevuld' || key === 'vervolg') {
                    // Exact match for dropdowns
                    if (field !== val.toLowerCase()) return false;
                } else {
                    // Substring match for text inputs
                    if (!field.includes(val.toLowerCase())) return false;
                }
            }
            return true;
        });

        if (sortKey && sortDir !== 0) {
            result.sort((a, b) => {
                let va = (a[sortKey] || '').toLowerCase();
                let vb = (b[sortKey] || '').toLowerCase();
                if (va < vb) return -1 * sortDir;
                if (va > vb) return 1 * sortDir;
                return 0;
            });
        }

        return result;
    }

    // Group a flat array of records by regNummer, preserving order
    function groupByReg(list) {
        const map = new Map();
        list.forEach(record => {
            const key = record.regNummer || '';
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(record);
        });
        return map; // Map<regNummer, record[]>
    }

    // Build an inline <select> for table cells
    function buildSelect(field, value, id, options) {
        let html = `<select class="inline-select" data-id="${id}" data-field="${field}">`;
        options.forEach(opt => {
            const label = opt || '-- Kies --';
            html += `<option value="${escapeHtml(opt)}"${opt === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        });
        html += '</select>';
        return html;
    }

    // Build an inline <select> that updates every record in a Reg. Nr. group when changed
    function buildGroupSelect(field, value, reg, options) {
        let html = `<select class="inline-select" data-reg="${escapeHtml(reg)}" data-field="${field}">`;
        options.forEach(opt => {
            const label = opt || '-- Kies --';
            html += `<option value="${escapeHtml(opt)}"${opt === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        });
        html += '</select>';
        return html;
    }

    // Build an inline date cell: text input (DD-MM-YYYY) + calendar button + hidden date picker
    function buildDateInput(field, value, id) {
        const display = value ? formatDate(value) : '';
        return `<span class="date-wrapper">` +
            `<input type="text" class="inline-date" data-id="${id}" data-field="${field}" data-type="date" value="${escapeHtml(display)}" placeholder="DD-MM-JJJJ">` +
            `<button type="button" class="date-picker-btn" tabindex="-1" title="Kalender openen">&#128197;</button>` +
            `<input type="date" class="hidden-date-input" tabindex="-1" value="${escapeHtml(value || '')}">` +
            `</span>`;
    }

    // Build an inline <input type="text"> for table cells
    function buildTextInput(field, value, id) {
        return `<input type="text" class="inline-text" data-id="${id}" data-field="${field}" value="${escapeHtml(value || '')}" title="${escapeHtml(value || '')}">`;
    }

    // Build an auto-growing <textarea> for multi-line table cells (Opmerking)
    function buildTextarea(field, value, id) {
        return `<textarea class="inline-textarea" data-id="${id}" data-field="${field}" rows="1">${escapeHtml(value || '')}</textarea>`;
    }

    // Build a single data-row's inner HTML (with inline editors)
    function buildRowCells(record, isChild) {
        const sc = calculateScore(record);
        const id = record.id;
        const regCell = isChild
            ? `<td class="score-${sc} child-indent"></td>`
            : `<td class="score-${sc}">${escapeHtml(record.regNummer)}</td>`;
        return `
            ${regCell}
            <td class="score-${sc}">${escapeHtml(record.woNummer)}</td>
            <td class="score-${sc}">${buildWaarCell(record.waar, id)}</td>
            <td class="score-${sc}">${buildSelect('monteur', record.monteur, id, MONTEUR_OPTIONS)}</td>
            <td class="score-${sc}">${buildDateInput('datumAanvang', record.datumAanvang, id)}</td>
            <td class="score-${sc}">${buildDateInput('datumEind', record.datumEind, id)}</td>
            <td class="cell-status ${statusColor('uitgevoerd', record.uitgevoerd)}">${buildSelect('uitgevoerd', record.uitgevoerd, id, UITGEVOERD_OPTIONS)}</td>
            <td class="cell-status ${statusColor('afgemeld', record.afgemeld)}">${buildSelect('afgemeld', record.afgemeld, id, AFGEMELD_OPTIONS)}</td>
            <td class="cell-status ${statusColor('referentie', record.referentie)}">${buildSelect('referentie', record.referentie, id, REFERENTIE_OPTIONS)}</td>
            <td class="cell-status ${statusColor('archiefGevuld', record.archiefGevuld)}">${buildSelect('archiefGevuld', record.archiefGevuld, id, ARCHIEF_OPTIONS)}</td>
            <td class="cell-status ${statusColor('vervolg', record.vervolg)}">${buildSelect('vervolg', record.vervolg, id, VERVOLG_OPTIONS)}</td>
            <td class="cell-opmerking">${buildTextarea('opmerking', record.opmerking, id)}</td>
            <td class="cell-actions">
                <button class="btn btn-danger" data-id="${id}">Verwijder</button>
            </td>
        `;
    }


    // Render table – groups records by regNummer.
    // Collapsed groups: one summary row at the sorted position of their first record.
    // Expanded groups: each record appears individually at its own sorted position.
    function renderTable() {
        tableBody.innerHTML = '';
        const displayed = getFilteredSorted();
        const allGroups = groupByReg(displayed);

        if (displayed.length === 0) {
            const tr = document.createElement('tr');
            tr.className = 'empty-state';
            tr.innerHTML = `<td colspan="13">Geen records gevonden.</td>`;
            tableBody.appendChild(tr);
            updateRowCount(0, 0);
            initTextareaHeights();
            updateStickyTops();
            return;
        }

        const renderedCollapsed = new Set();

        for (const record of displayed) {
            const reg = record.regNummer || '';
            const recs = allGroups.get(reg) || [record];
            const hasMultiple = recs.length > 1;
            const isExpanded = expandedGroups.has(reg);

            if (hasMultiple && !isExpanded) {
                // Collapsed: one summary row at the position of the first occurrence
                if (renderedCollapsed.has(reg)) continue;
                renderedCollapsed.add(reg);

                const summary = groupSummary(recs);
                const sc = calculateScore(summary);
                const expandBtn = `<button class="btn-expand" data-reg="${escapeHtml(reg)}">\u25B6</button> `;
                const countBadge = `<span class="group-count">${recs.length}</span>`;

                const tr = document.createElement('tr');
                tr.classList.add('group-parent');
                tr.innerHTML = `
                    <td class="score-${sc}">${expandBtn}${escapeHtml(reg)}${countBadge}</td>
                    <td class="score-${sc}"></td>
                    <td class="score-${sc}">${buildWaarCell(recs[0].waar, recs[0].id)}</td>
                    <td class="score-${sc}"></td>
                    <td class="score-${sc}"></td>
                    <td class="score-${sc}"></td>
                    <td class="cell-status ${statusColor('uitgevoerd', summary.uitgevoerd)}">${escapeHtml(summary.uitgevoerd)}</td>
                    <td class="cell-status ${statusColor('afgemeld', summary.afgemeld)}">${escapeHtml(summary.afgemeld)}</td>
                    <td class="cell-status ${statusColor('referentie', recs[0].referentie)}">${buildGroupSelect('referentie', recs[0].referentie, reg, REFERENTIE_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('archiefGevuld', recs[0].archiefGevuld)}">${buildGroupSelect('archiefGevuld', recs[0].archiefGevuld, reg, ARCHIEF_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('vervolg', summary.vervolg)}">${escapeHtml(summary.vervolg)}</td>
                    <td class="cell-opmerking"></td>
                    <td class="cell-actions">
                        <button class="btn btn-danger" data-id="${recs[0].id}" disabled title="Klap de groep uit om een record te verwijderen">Verwijder</button>
                    </td>
                `;
                tableBody.appendChild(tr);
            } else {
                // Expanded multi-record row, or single-record row — each at its own sorted position
                const sc = calculateScore(record);
                const id = record.id;
                const expandBtn = hasMultiple
                    ? `<button class="btn-expand" data-reg="${escapeHtml(reg)}">\u25BC</button> `
                    : '';
                const countBadge = hasMultiple
                    ? `<span class="group-count">${recs.length}</span>`
                    : '';

                const today = new Date().toISOString().slice(0, 10);
                const eindOverdue = record.datumEind && record.datumEind < today && record.afgemeld === 'Nee';
                const aanvangSpecial = record.datumAanvang && record.datumAanvang.slice(5) === '12-31';

                const tr = document.createElement('tr');
                if (hasMultiple) tr.classList.add('group-parent');
                tr.innerHTML = `
                    <td class="score-${sc}">${expandBtn}${escapeHtml(record.regNummer)}${countBadge}</td>
                    <td class="score-${sc}">${escapeHtml(record.woNummer)}</td>
                    <td class="score-${sc}">${buildWaarCell(record.waar, id)}</td>
                    <td class="score-${sc}">${buildSelect('monteur', record.monteur, id, MONTEUR_OPTIONS)}</td>
                    <td class="score-${sc}${aanvangSpecial ? ' cell-overdue' : ''}">${buildDateInput('datumAanvang', record.datumAanvang, id)}</td>
                    <td class="score-${sc}${eindOverdue ? ' cell-overdue' : ''}">${buildDateInput('datumEind', record.datumEind, id)}</td>
                    <td class="cell-status ${statusColor('uitgevoerd', record.uitgevoerd)}">${buildSelect('uitgevoerd', record.uitgevoerd, id, UITGEVOERD_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('afgemeld', record.afgemeld)}">${buildSelect('afgemeld', record.afgemeld, id, AFGEMELD_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('referentie', record.referentie)}">${buildSelect('referentie', record.referentie, id, REFERENTIE_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('archiefGevuld', record.archiefGevuld)}">${buildSelect('archiefGevuld', record.archiefGevuld, id, ARCHIEF_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('vervolg', record.vervolg)}">${buildSelect('vervolg', record.vervolg, id, VERVOLG_OPTIONS)}</td>
                    <td class="cell-opmerking">${buildTextarea('opmerking', record.opmerking, id)}</td>
                    <td class="cell-actions">
                        <button class="btn btn-danger" data-id="${id}">Verwijder</button>
                    </td>
                `;
                tableBody.appendChild(tr);
            }
        }

        updateRowCount(displayed.length, allGroups.size);
        initTextareaHeights();
        updateStickyTops();
    }

    // Keep the filter row's sticky offset equal to the actual rendered height of the
    // header row, so both rows freeze correctly at the top when scrolling.
    function updateStickyTops() {
        const headerRow = document.getElementById('headerRow');
        if (!headerRow) return;
        const h = headerRow.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--filter-row-top', h + 'px');
    }

    // Set textarea heights to fit their content (JS fallback for field-sizing: content)
    function initTextareaHeights() {
        tableBody.querySelectorAll('.inline-textarea').forEach(ta => {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        });
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Update row count display
    function updateRowCount(displayedCount, groupCount) {
        const total = records.length;
        if (displayedCount < total) {
            rowCount.textContent = `${displayedCount} records (${groupCount} registraties) / ${total} totaal`;
        } else {
            rowCount.textContent = `${total} records (${groupCount} registraties)`;
        }
    }

    // Open modal
    function openModal(title) {
        modalTitle.textContent = title;
        modal.classList.remove('hidden');
    }

    // Close modal
    function closeModal() {
        modal.classList.add('hidden');
        recordForm.reset();
        editingId = null;
    }

    // Get form data
    function getFormData() {
        const waarRaw  = document.getElementById('waar').value.trim();
        const waar     = processWaar(waarRaw);
        // Flag for manual review if the entered value didn't start with NRC
        // and is not already a known correction.
        if (waarRaw && !/^NRC/i.test(waarRaw) &&
                !Object.prototype.hasOwnProperty.call(waarMappings, waarRaw) && waar) {
            waarNeedsReview.add(waar);
            saveWaarNeedsReview();
        }
        return {
            regNummer: REG_PREFIX + document.getElementById('regNummer').value.trim(),
            woNummer: WO_PREFIX + document.getElementById('woNummer').value.trim(),
            waar,
            monteur: document.getElementById('monteur').value.trim(),
            datumAanvang: document.getElementById('datumAanvang').value,
            datumEind: document.getElementById('datumEind').value,
            uitgevoerd: document.getElementById('uitgevoerd').value,
            afgemeld: document.getElementById('afgemeld').value,
            referentie: document.getElementById('referentie').value,
            archiefGevuld: document.getElementById('archiefGevuld').value,
            vervolg: document.getElementById('vervolg').value,
            opmerking: document.getElementById('opmerking').value.trim(),
        };
    }

    // Populate form with record data
    function populateForm(record) {
        // Strip known prefixes for the input fields; fall back to last 4 chars
        const regVal = (record.regNummer || '');
        document.getElementById('regNummer').value = regVal.startsWith(REG_PREFIX)
            ? regVal.slice(REG_PREFIX.length)
            : regVal.slice(-4);

        const woVal = (record.woNummer || '');
        document.getElementById('woNummer').value = woVal.startsWith(WO_PREFIX)
            ? woVal.slice(WO_PREFIX.length)
            : woVal.slice(-4);

        document.getElementById('waar').value = record.waar || '';
        document.getElementById('monteur').value = record.monteur || '';
        document.getElementById('datumAanvang').value = record.datumAanvang || '';
        document.getElementById('datumEind').value = record.datumEind || '';
        document.getElementById('uitgevoerd').value = record.uitgevoerd || 'Nee';
        document.getElementById('afgemeld').value = record.afgemeld || 'Nee';
        document.getElementById('referentie').value = record.referentie || 'Nee';
        document.getElementById('archiefGevuld').value = record.archiefGevuld || 'Ja';
        document.getElementById('vervolg').value = record.vervolg || 'Nee';
        document.getElementById('opmerking').value = record.opmerking || '';
    }

    // Generate unique ID
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // ── Column resize logic ──────────────────────────────────────────
    function initColumnResize() {
        const table = document.getElementById('registrationTable');
        const headerCells = document.querySelectorAll('#headerRow th');

        headerCells.forEach(th => {
            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            // position: sticky (from CSS) already creates a containing block for the
            // absolutely-positioned handle — no inline override needed here.
            th.appendChild(handle);

            let startX, startWidth;

            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation(); // don't trigger sort
                resizing = true;
                startX = e.pageX;
                startWidth = th.offsetWidth;
                table.style.tableLayout = 'fixed';

                // Set all column widths to current values before manual resize
                if (!table.dataset.resized) {
                    headerCells.forEach(cell => {
                        cell.style.width = cell.offsetWidth + 'px';
                    });
                    table.dataset.resized = '1';
                }

                const onMouseMove = (e2) => {
                    const diff = e2.pageX - startX;
                    const newWidth = Math.max(30, startWidth + diff);
                    th.style.width = newWidth + 'px';
                };

                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    // Clear resizing flag after the click event has fired
                    setTimeout(() => { resizing = false; }, 0);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        });
    }

    // ── Event handlers ───────────────────────────────────────────────

    // Event: Apply processWaar to every existing record
    document.getElementById('verwerkWaarBtn').addEventListener('click', () => {
        let changed = 0;
        records.forEach(r => {
            const updated = processWaar(r.waar);
            if (updated !== r.waar) { r.waar = updated; changed++; }
        });
        if (changed > 0) {
            saveRecords();
            renderTable();
            alert(`Waar verwerkt: ${changed} record(s) bijgewerkt.`);
        } else {
            alert('Geen wijzigingen: alle Waar-waarden zijn al correct.');
        }
    });

    // Event: Expand all groups
    document.getElementById('expandAllBtn').addEventListener('click', () => {
        groupByReg(getFilteredSorted()).forEach((recs, reg) => {
            if (recs.length > 1) expandedGroups.add(reg);
        });
        renderTable();
    });

    // Event: Collapse all groups
    document.getElementById('collapseAllBtn').addEventListener('click', () => {
        expandedGroups.clear();
        renderTable();
    });

    // Event: Add new record
    addRowBtn.addEventListener('click', () => {
        editingId = null;
        openModal('Nieuw Record');
    });

    // Event: Submit form
    recordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = getFormData();
        applyAfgemeldRules(data);

        if (editingId) {
            const index = records.findIndex(r => r.id === editingId);
            if (index !== -1) {
                records[index] = { ...data, id: editingId };
            }
        } else {
            records.push({ ...data, id: generateId() });
        }

        saveRecords();
        renderTable();
        closeModal();
    });

    // Event: Cancel
    cancelBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', closeModal);

    // Prevent the calendar button from stealing focus from the text input (avoids premature change event)
    tableBody.addEventListener('mousedown', (e) => {
        if (e.target.closest('.date-picker-btn')) e.preventDefault();
    });

    // Event: Edit, Delete, or Expand via table delegation
    tableBody.addEventListener('click', (e) => {
        // Expand / collapse button
        const expandBtn = e.target.closest('.btn-expand');
        if (expandBtn) {
            const reg = expandBtn.dataset.reg;
            if (expandedGroups.has(reg)) {
                expandedGroups.delete(reg);
            } else {
                expandedGroups.add(reg);
            }
            renderTable();
            return;
        }

        // Calendar picker button – open the hidden date input's native picker
        const datePickerBtn = e.target.closest('.date-picker-btn');
        if (datePickerBtn) {
            const hiddenInput = datePickerBtn.nextElementSibling;
            if (hiddenInput) {
                try { hiddenInput.showPicker(); } catch (_) {}
            }
            return;
        }

        const btn = e.target.closest('button');
        if (!btn) return;

        const id = btn.dataset.id;

        if (btn.classList.contains('btn-danger')) {
            if (confirm('Weet je zeker dat je dit record wilt verwijderen?')) {
                records = records.filter(r => r.id !== id);
                saveRecords();
                renderTable();
            }
        }
    });

    // Event: Inline select/date change – save and re-render for updated colors/scores
    tableBody.addEventListener('change', (e) => {
        const el = e.target;
        if (el.classList.contains('inline-text') || el.classList.contains('inline-textarea')) return; // handled by input event

        const wrapper = document.querySelector('.table-wrapper');
        const scrollTop = wrapper.scrollTop;
        const scrollLeft = wrapper.scrollLeft;

        // Hidden date input (native calendar picker): sync value back to text input and save
        if (el.classList.contains('hidden-date-input')) {
            const dateWrap = el.closest('.date-wrapper');
            if (!dateWrap) return;
            const textInput = dateWrap.querySelector('.inline-date');
            if (!textInput?.dataset.id || !textInput?.dataset.field) return;
            textInput.value = el.value ? formatDate(el.value) : '';
            const rec = records.find(r => r.id === textInput.dataset.id);
            if (!rec) return;
            rec[textInput.dataset.field] = el.value;
            saveRecords();
            renderTable();
            wrapper.scrollTop = scrollTop;
            wrapper.scrollLeft = scrollLeft;
            return;
        }

        // Group-level select (collapsed row): update all records in the group
        if (el.dataset.reg && el.dataset.field) {
            const reg = el.dataset.reg;
            records.forEach(r => { if (r.regNummer === reg) r[el.dataset.field] = el.value; });
            saveRecords();
            renderTable();
            wrapper.scrollTop = scrollTop;
            wrapper.scrollLeft = scrollLeft;
            return;
        }

        if (!el.dataset.id || !el.dataset.field) return;
        const record = records.find(r => r.id === el.dataset.id);
        if (!record) return;
        const field = el.dataset.field;
        const newValue = el.dataset.type === 'date' ? parseDisplayDate(el.value) : el.value;
        // For referentie and archiefGevuld, propagate the change to every WO-nr in the group
        if (field === 'referentie' || field === 'archiefGevuld') {
            records.forEach(r => { if (r.regNummer === record.regNummer) r[field] = newValue; });
        } else {
            record[field] = newValue;
            if (field === 'afgemeld') applyAfgemeldRules(record);
        }
        saveRecords();
        renderTable();
        wrapper.scrollTop = scrollTop;
        wrapper.scrollLeft = scrollLeft;
    });

    // Event: Inline text/textarea input – save on each keystroke (no re-render needed)
    tableBody.addEventListener('input', (e) => {
        const el = e.target;
        const isText     = el.classList.contains('inline-text');
        const isTextarea = el.classList.contains('inline-textarea');
        if ((!isText && !isTextarea) || !el.dataset.id || !el.dataset.field) return;
        const record = records.find(r => r.id === el.dataset.id);
        if (record) {
            record[el.dataset.field] = el.value;
            saveRecords();
        }
        if (isTextarea) {
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        }
    });

    // Commit a confirmed "waar" correction (called after "Ja" in the dialog)
    function commitWaarEdit(original, newValue) {
        // Propagate the correction to every record that shares the original value
        records.forEach(r => { if (r.waar === original) r.waar = newValue; });
        // Persist the mapping so future imports auto-correct the same value
        waarMappings[original] = newValue;
        saveWaarMappings();
        // Mark as no longer needing review
        waarNeedsReview.delete(original);
        saveWaarNeedsReview();
        saveRecords();
        const wrapper = document.querySelector('.table-wrapper');
        const scrollTop = wrapper.scrollTop;
        const scrollLeft = wrapper.scrollLeft;
        renderTable();
        wrapper.scrollTop = scrollTop;
        wrapper.scrollLeft = scrollLeft;
    }

    // Event: on focusout of a waar-input, show a confirmation dialog
    tableBody.addEventListener('focusout', (e) => {
        const el = e.target;
        if (!el.classList.contains('waar-input')) return;
        const original = el.dataset.original;
        const newValue = el.value.trim();
        if (!newValue || newValue === original) return;
        // Store the pending edit and ask for confirmation
        pendingWaarEdit = { el, original, newValue };
        waarConfirmMsg.textContent =
            `Wilt u dit veld aanpassen naar "${newValue}"? ` +
            'Aanpassen is daarna niet meer mogelijk';
        waarConfirmDialog.classList.remove('hidden');
        waarConfirmJa.focus();
    });

    // Event: "Ja" — commit the pending edit
    waarConfirmJa.addEventListener('click', () => {
        waarConfirmDialog.classList.add('hidden');
        if (!pendingWaarEdit) return;
        const { original, newValue } = pendingWaarEdit;
        pendingWaarEdit = null;
        commitWaarEdit(original, newValue);
    });

    // Event: "Nee" — abort; restore the input to its original value
    waarConfirmNee.addEventListener('click', () => {
        waarConfirmDialog.classList.add('hidden');
        if (!pendingWaarEdit) return;
        const { el, original } = pendingWaarEdit;
        pendingWaarEdit = null;
        el.value = original;
    });

    // Event: Enter key confirms a "waar" correction (triggers focusout)
    tableBody.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList.contains('waar-input')) {
            e.preventDefault();
            e.target.blur();
        }
    });

    // Event: Close modal / confirmation dialog with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!waarConfirmDialog.classList.contains('hidden')) {
            waarConfirmNee.click();
        } else if (!modal.classList.contains('hidden')) {
            closeModal();
        }
    });

    // Restrict prefix inputs to digits only
    document.getElementById('regNummer').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });
    document.getElementById('woNummer').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });

    // Event: Sort on header click
    document.getElementById('headerRow').addEventListener('click', (e) => {
        if (resizing) return; // ignore clicks caused by column resize
        const th = e.target.closest('th[data-key]');
        if (!th) return;
        const key = th.dataset.key;

        if (sortKey === key) {
            // Cycle: asc → desc → none
            sortDir = sortDir === 1 ? -1 : 0;
            if (sortDir === 0) sortKey = null;
        } else {
            sortKey = key;
            sortDir = 1;
        }

        // Update arrow indicators
        document.querySelectorAll('#headerRow .sort-arrow').forEach(el => el.textContent = '');
        if (sortKey) {
            const arrow = th.querySelector('.sort-arrow');
            arrow.textContent = sortDir === 1 ? ' \u25B2' : ' \u25BC';
        }

        renderTable();
    });


    // Event: Filter on input/select change
    document.querySelectorAll('#filterRow .filter-input').forEach(input => {
        input.addEventListener('input', () => {
            filters[input.dataset.key] = input.value;
            renderTable();
        });
    });
    document.querySelectorAll('#filterRow .filter-select').forEach(select => {
        select.addEventListener('change', () => {
            filters[select.dataset.key] = select.value;
            renderTable();
        });
    });

    // ── CSV import ───────────────────────────────────────────────────

    // Convert a date string to YYYY-MM-DD; handles DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD
    function normaliseDate(s) {
        if (!s) return '';
        s = s.trim();
        const dmY = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
        if (dmY) return `${dmY[3]}-${dmY[2].padStart(2, '0')}-${dmY[1].padStart(2, '0')}`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        return '';
    }

    // Strip "NRC-" prefix if present
    function stripNrc(s) {
        return s.startsWith('NRC-') ? s.slice(4) : s;
    }

    // Transform a raw "Dossier" value from CSV into the stored "waar" value:
    // 1. If it starts with "NRC", strip "NRC" + any following spaces/dashes
    //    e.g. "NRC - Foo" → "Foo",  "NRC-Foo" → "Foo",  "NRCFoo" → "Foo"
    // 2. Apply any known user correction mapping (if the address was previously corrected)
    // Non-NRC values are returned as-is; callers are responsible for flagging them.
    function processWaar(raw) {
        if (!raw) return raw;
        let v = raw.trim();
        // Strip leading "NRC" + any combination of spaces and dashes
        if (/^NRC/i.test(v)) v = v.replace(/^NRC[-\s]*/i, '');
        // Apply persisted correction mapping
        if (Object.prototype.hasOwnProperty.call(waarMappings, v)) v = waarMappings[v];
        return v;
    }

    // Returns true when a "waar" value needs manual correction:
    // – explicitly marked as non-NRC during import/entry, OR
    // – (legacy) still starts with 4 digits (postal-code prefix).
    function waarNeedsFlag(value) {
        return waarNeedsReview.has(value || '') || /^\d{4}/.test(value || '');
    }

    // Build the table cell content for a "waar" value.
    // Flagged values get a red editable input; others plain text.
    function buildWaarCell(value, id) {
        if (waarNeedsFlag(value)) {
            const esc = escapeHtml(value || '');
            return `<input type="text" class="inline-text waar-input waar-flagged" ` +
                   `data-id="${id}" data-field="waar" data-original="${esc}" ` +
                   `value="${esc}" title="Aanpassen vereist: niet afkomstig van NRC">`;
        }
        return escapeHtml(value);
    }


    // Parse CSV text into an array of row objects keyed by header name
    function parseCsvRaw(text) {
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const nonEmpty = lines.filter(l => l.trim() !== '');
        if (nonEmpty.length < 2) return [];

        const headerLine = nonEmpty[0];
        const delim = (headerLine.split(';').length > headerLine.split(',').length) ? ';' : ',';

        function splitLine(line) {
            const fields = [];
            let cur = '', inQuote = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') {
                    if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
                    else inQuote = !inQuote;
                } else if (ch === delim && !inQuote) {
                    fields.push(cur); cur = '';
                } else {
                    cur += ch;
                }
            }
            fields.push(cur);
            return fields;
        }

        const headers = splitLine(headerLine).map(h => h.trim().replace(/^"|"$/g, ''));
        const rows = [];
        for (let i = 1; i < nonEmpty.length; i++) {
            const vals = splitLine(nonEmpty[i]);
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = (vals[idx] || '').trim().replace(/^"|"$/g, '');
            });
            rows.push(row);
        }
        return rows;
    }

    // Look up a column value by trying multiple header names (case/space-insensitive)
    function col(row, ...names) {
        const rowKeys = Object.keys(row);
        for (const name of names) {
            const norm = name.toLowerCase().replace(/[\s.]/g, '');
            const key = rowKeys.find(k => k.toLowerCase().replace(/[\s.]/g, '') === norm);
            if (key !== undefined) return row[key] || '';
        }
        return '';
    }

    // Status (short code) → Afg. mapping
    const STATUS_TO_AFG = {
        '1ewog':       'Ja',   // 1e werkorder gereed
        'faccr':       'Ja',   // Factuur gecrediteerd
        'facjo':       'Ja',   // Factuur gejournaliseerd
        'gere':        'Ja',   // Gereed
        'gf':          'Ja',   // Gereed gefactureerd
        'gnf':         'Ja',   // Gereed niet gefactureerd
        // 'verw' is intentionally omitted — those rows are skipped on import
        'annul':       'Ja',   // Geannuleerd → also Uitg. = Vervallen
        'vervallen':   'Ja',   // Vervallen    → also Uitg. = Vervallen
        'onderhanden': 'Nee',  // In uitvoering
        'aan':         'Nee',  // Aangemaakt
    };
    // Statuses that also force Uitgevoerd = Vervallen
    const STATUS_VERVALLEN = new Set(['annul', 'vervallen']);

    // Map one raw CSV row to record fields; appends to warnings[] for unknown statuses
    function csvRowToRecord(row, warnings) {
        const regNummer  = stripNrc(col(row, 'Registratienr.', 'Registratienr', 'Registratienummer'));
        const woNummer   = col(row, 'Werkordernummer', 'WO-nr.', 'WO-nummer');
        const rawDossier = col(row, 'Dossier');
        const waar       = processWaar(rawDossier);
        // Flag for manual review when the raw value did not start with NRC
        // and is not already a known (previously corrected) mapping.
        const waarReview = !!rawDossier.trim()
            && !/^NRC/i.test(rawDossier.trim())
            && !Object.prototype.hasOwnProperty.call(waarMappings, rawDossier.trim());
        const datumAanvang = normaliseDate(col(row, 'Uitvoerings datum', 'Uitvoeringsdatum'));

        // Afg. + Uitg. from Status (short code)
        const statusRaw = col(row, 'Status omschr.', 'Status omschr', 'Statusomschrijving', 'Status');
        const statusKey = statusRaw.toLowerCase().trim();
        let afgemeld, uitgevoerd;
        if (STATUS_TO_AFG.hasOwnProperty(statusKey)) {
            afgemeld   = STATUS_TO_AFG[statusKey];
            uitgevoerd = STATUS_VERVALLEN.has(statusKey) ? 'Vervallen' : undefined;
        } else {
            afgemeld = 'Nee';
            if (statusRaw) {
                warnings.push(`WO-nr. ${woNummer || '(leeg)'}: onbekende status "${statusRaw}"`);
            }
        }

        // Ref. from Referentie column
        const refRaw = col(row, 'Referentie');
        const referentie = refRaw ? 'Ingevuld' : 'Nee';

        return { regNummer, woNummer, waar, waarReview, datumAanvang, afgemeld, uitgevoerd, referentie, statusKey };
    }

    // ── CSV file import ──────────────────────────────────────────────
    document.getElementById('csvFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const rawRows = parseCsvRaw(evt.target.result);
            if (rawRows.length === 0) {
                alert('Geen geldige records gevonden. Controleer of de koptekstrij aanwezig is.');
                e.target.value = '';
                return;
            }

            const warnings = [];
            let added = 0, updated = 0, skipped = 0, tooOld = 0;

            rawRows.forEach(row => {
                const imp = csvRowToRecord(row, warnings);

                if (!imp.woNummer) { skipped++; return; }
                if (imp.statusKey === 'verw') { skipped++; return; }
                if (imp.datumAanvang && imp.datumAanvang < '2026-01-01') { tooOld++; return; }

                // Track non-NRC waar values for manual-review flagging
                if (imp.waarReview && imp.waar) waarNeedsReview.add(imp.waar);

                const existing = records.find(r => r.woNummer === imp.woNummer);
                if (existing) {
                    if (imp.regNummer)    existing.regNummer    = imp.regNummer;
                    if (imp.waar)         existing.waar         = imp.waar;
                    if (imp.datumAanvang) existing.datumAanvang = imp.datumAanvang;
                    existing.afgemeld  = imp.afgemeld;
                    if (imp.uitgevoerd !== undefined) existing.uitgevoerd = imp.uitgevoerd;
                    applyAfgemeldRules(existing);
                    if (existing.referentie === 'Nee' && imp.referentie !== 'Nee') {
                        existing.referentie = imp.referentie;
                    }
                    updated++;
                } else {
                    const newRec = {
                        id:            generateId(),
                        regNummer:     imp.regNummer,
                        woNummer:      imp.woNummer,
                        waar:          imp.waar,
                        monteur:       '',
                        datumAanvang:  imp.datumAanvang,
                        datumEind:     '',
                        uitgevoerd:    imp.uitgevoerd !== undefined ? imp.uitgevoerd : 'Nee',
                        afgemeld:      imp.afgemeld,
                        referentie:    imp.referentie,
                        archiefGevuld: 'Ja',
                        vervolg:       'Nee',
                        opmerking:     '',
                    };
                    applyAfgemeldRules(newRec);
                    records.push(newRec);
                    added++;
                }
            });

            // Drop reg. nr. groups where every WO-nr still has no datumAanvang.
            const regWithDate = new Set(records.filter(r => r.datumAanvang).map(r => r.regNummer));
            records = records.filter(r => regWithDate.has(r.regNummer));

            saveRecords();
            saveWaarNeedsReview();
            expandedGroups.clear();
            renderTable();

            let msg = `Import klaar: ${added} toegevoegd, ${updated} bijgewerkt`;
            if (skipped)  msg += `, ${skipped} overgeslagen (geen WO-nr.)`;
            if (tooOld)   msg += `, ${tooOld} overgeslagen (aanvang vóór 2026)`;
            msg += '.';
            if (warnings.length > 0) {
                msg += `\n\nLet op – de volgende records hebben een onbekende status en moeten handmatig worden ingesteld:\n\n`;
                msg += warnings.join('\n');
            }
            alert(msg);
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    // Re-compute sticky offsets when the user resizes the window (font/zoom changes
    // can alter the header row height).
    window.addEventListener('resize', updateStickyTops);

    // Initial render
    renderTable();
    initColumnResize();
});
