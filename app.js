document.addEventListener('DOMContentLoaded', () => {
    const STORAGE_KEY = 'registrationAppData';
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

    let records = loadRecords();
    let editingId = null;

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
    const REFERENTIE_OPTIONS = ['Nee', 'Ingevuld, nakijken', 'Ja', 'Onnodig'];
    const ARCHIEF_OPTIONS = ['Ja', 'Onvolledig', 'Nee'];
    const VERVOLG_OPTIONS = ['Nee', 'Gepland', 'Ja', 'Onbekend'];

    // Priority rankings for status fields (lower index = worse)
    const STATUS_RANK = {
        uitgevoerd:    ['Nee', 'Bezig', 'Ja', 'Vervallen'],
        afgemeld:      ['Nee', 'Ja'],
        referentie:    ['Nee', 'Ingevuld, nakijken', 'Ja', 'Onnodig'],
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
            referentie:   { green: ['Ja', 'Onnodig'], yellow: ['Ingevuld, nakijken'], red: ['Nee'] },
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

    // Load records from localStorage, seed with INITIAL_DATA on first run
    function loadRecords() {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) return JSON.parse(data);
        if (typeof INITIAL_DATA !== 'undefined' && INITIAL_DATA.length > 0) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_DATA));
            return [...INITIAL_DATA];
        }
        return [];
    }

    // Save records to localStorage
    function saveRecords() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    }

    // Format date for display (DD-MM-YYYY)
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    // Apply filters and sorting to records
    function getFilteredSorted() {
        let result = records.filter(record => {
            for (const key in filters) {
                const val = filters[key];
                if (!val) continue;
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

    // Build an inline <input type="date"> for table cells
    function buildDateInput(field, value, id) {
        return `<input type="date" class="inline-date" data-id="${id}" data-field="${field}" value="${escapeHtml(value || '')}">`;
    }

    // Build an inline <input type="text"> for table cells
    function buildTextInput(field, value, id) {
        return `<input type="text" class="inline-text" data-id="${id}" data-field="${field}" value="${escapeHtml(value || '')}" title="${escapeHtml(value || '')}">`;
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
            <td class="score-${sc}">${escapeHtml(record.waar)}</td>
            <td class="score-${sc}">${buildSelect('monteur', record.monteur, id, MONTEUR_OPTIONS)}</td>
            <td class="score-${sc}">${buildDateInput('datumAanvang', record.datumAanvang, id)}</td>
            <td class="score-${sc}">${buildDateInput('datumEind', record.datumEind, id)}</td>
            <td class="cell-status ${statusColor('uitgevoerd', record.uitgevoerd)}">${buildSelect('uitgevoerd', record.uitgevoerd, id, UITGEVOERD_OPTIONS)}</td>
            <td class="cell-status ${statusColor('afgemeld', record.afgemeld)}">${buildSelect('afgemeld', record.afgemeld, id, AFGEMELD_OPTIONS)}</td>
            <td class="cell-status ${statusColor('referentie', record.referentie)}">${buildSelect('referentie', record.referentie, id, REFERENTIE_OPTIONS)}</td>
            <td class="cell-status ${statusColor('archiefGevuld', record.archiefGevuld)}">${buildSelect('archiefGevuld', record.archiefGevuld, id, ARCHIEF_OPTIONS)}</td>
            <td class="cell-status ${statusColor('vervolg', record.vervolg)}">${buildSelect('vervolg', record.vervolg, id, VERVOLG_OPTIONS)}</td>
            <td class="cell-opmerking">${buildTextInput('opmerking', record.opmerking, id)}</td>
            <td class="cell-actions">
                <button class="btn btn-danger" data-id="${id}">Verwijder</button>
            </td>
        `;
    }

    // Render table – groups records by regNummer
    function renderTable() {
        tableBody.innerHTML = '';
        const displayed = getFilteredSorted();
        const groups = groupByReg(displayed);

        if (displayed.length === 0) {
            const tr = document.createElement('tr');
            tr.className = 'empty-state';
            tr.innerHTML = `<td colspan="13">Geen records gevonden.</td>`;
            tableBody.appendChild(tr);
        } else {
            groups.forEach((recs, regNummer) => {
                const first = recs[0];
                const hasMultiple = recs.length > 1;
                const isExpanded = expandedGroups.has(regNummer);

                // For multi-record groups, compute worst status values (only when collapsed)
                const summary = (hasMultiple && !isExpanded) ? groupSummary(recs) : null;
                const dispUitg     = summary ? summary.uitgevoerd    : first.uitgevoerd;
                const dispAfg      = summary ? summary.afgemeld      : first.afgemeld;
                const dispRef      = summary ? summary.referentie    : first.referentie;
                const dispArchief  = summary ? summary.archiefGevuld : first.archiefGevuld;
                const dispVervolg  = summary ? summary.vervolg       : first.vervolg;

                // Score is computed from displayed (worst) values
                const scoreRecord = summary
                    ? { uitgevoerd: dispUitg, afgemeld: dispAfg, referentie: dispRef, archiefGevuld: dispArchief, vervolg: dispVervolg }
                    : first;
                const sc = calculateScore(scoreRecord);

                // Parent / only row
                const tr = document.createElement('tr');
                if (hasMultiple) tr.classList.add('group-parent');
                const isSummary = hasMultiple && !isExpanded;

                const expandBtn = hasMultiple
                    ? `<button class="btn-expand" data-reg="${escapeHtml(regNummer)}">${isExpanded ? '\u25BC' : '\u25B6'}</button> `
                    : '';
                const countBadge = hasMultiple
                    ? `<span class="group-count">${recs.length}</span>`
                    : '';

                tr.innerHTML = `
                    <td class="score-${sc}">${expandBtn}${escapeHtml(first.regNummer)}${countBadge}</td>
                    <td class="score-${sc}">${escapeHtml(first.woNummer)}</td>
                    <td class="score-${sc}">${escapeHtml(first.waar)}</td>
                    <td class="score-${sc}">${isSummary ? escapeHtml(first.monteur) : buildSelect('monteur', first.monteur, first.id, MONTEUR_OPTIONS)}</td>
                    <td class="score-${sc}">${isSummary ? formatDate(first.datumAanvang) : buildDateInput('datumAanvang', first.datumAanvang, first.id)}</td>
                    <td class="score-${sc}">${isSummary ? formatDate(first.datumEind) : buildDateInput('datumEind', first.datumEind, first.id)}</td>
                    <td class="cell-status ${statusColor('uitgevoerd', dispUitg)}">${isSummary ? escapeHtml(dispUitg) : buildSelect('uitgevoerd', first.uitgevoerd, first.id, UITGEVOERD_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('afgemeld', dispAfg)}">${isSummary ? escapeHtml(dispAfg) : buildSelect('afgemeld', first.afgemeld, first.id, AFGEMELD_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('referentie', dispRef)}">${isSummary ? escapeHtml(dispRef) : buildSelect('referentie', first.referentie, first.id, REFERENTIE_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('archiefGevuld', dispArchief)}">${isSummary ? escapeHtml(dispArchief) : buildSelect('archiefGevuld', first.archiefGevuld, first.id, ARCHIEF_OPTIONS)}</td>
                    <td class="cell-status ${statusColor('vervolg', dispVervolg)}">${isSummary ? escapeHtml(dispVervolg) : buildSelect('vervolg', first.vervolg, first.id, VERVOLG_OPTIONS)}</td>
                    <td class="cell-opmerking">${isSummary ? '' : buildTextInput('opmerking', first.opmerking, first.id)}</td>
                    <td class="cell-actions">
                        <button class="btn btn-danger" data-id="${first.id}">Verwijder</button>
                    </td>
                `;
                tableBody.appendChild(tr);

                // Child rows (only when expanded)
                if (hasMultiple && isExpanded) {
                    for (let i = 1; i < recs.length; i++) {
                        const child = recs[i];
                        const ctr = document.createElement('tr');
                        ctr.classList.add('group-child');
                        ctr.innerHTML = buildRowCells(child, true);
                        tableBody.appendChild(ctr);
                    }
                }
            });
        }

        updateRowCount(displayed.length, groups.size);
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
        return {
            regNummer: REG_PREFIX + document.getElementById('regNummer').value.trim(),
            woNummer: WO_PREFIX + document.getElementById('woNummer').value.trim(),
            waar: document.getElementById('waar').value.trim(),
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
            th.style.position = 'relative';
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

    // Event: Reset data to original import
    document.getElementById('resetBtn').addEventListener('click', () => {
        if (confirm('Weet je zeker? Dit laadt de originele 154 records opnieuw in en verwijdert eventuele wijzigingen.')) {
            localStorage.removeItem(STORAGE_KEY);
            records = loadRecords();
            expandedGroups.clear();
            renderTable();
        }
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
        if (el.classList.contains('inline-text')) return; // text handled by input event
        if (!el.dataset.id || !el.dataset.field) return;
        const record = records.find(r => r.id === el.dataset.id);
        if (!record) return;
        record[el.dataset.field] = el.value;
        saveRecords();
        const wrapper = document.querySelector('.table-wrapper');
        const scrollTop = wrapper.scrollTop;
        const scrollLeft = wrapper.scrollLeft;
        renderTable();
        wrapper.scrollTop = scrollTop;
        wrapper.scrollLeft = scrollLeft;
    });

    // Event: Inline text input – save on each keystroke (no re-render needed)
    tableBody.addEventListener('input', (e) => {
        const el = e.target;
        if (!el.classList.contains('inline-text') || !el.dataset.id || !el.dataset.field) return;
        const record = records.find(r => r.id === el.dataset.id);
        if (record) {
            record[el.dataset.field] = el.value;
            saveRecords();
        }
    });

    // Event: Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
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

    // Status omschr. → Afg. mapping
    const STATUS_TO_AFG = {
        'gereed niet gefactureerd': 'Ja',
        'factuur gejournaliseerd':  'Ja',
        'administratief gereed':    'Ja',
        '1e werkorder gereed':      'Ja',
        'aangemaakt':               'Nee',
    };

    // Map one raw CSV row to record fields; appends to warnings[] for unknown statuses
    function csvRowToRecord(row, warnings) {
        const regNummer  = stripNrc(col(row, 'Registratienr.', 'Registratienr', 'Registratienummer'));
        const woNummer   = col(row, 'Werkordernummer', 'WO-nr.', 'WO-nummer');
        const waar       = stripNrc(col(row, 'Dossier'));
        const datumAanvang = normaliseDate(col(row, 'Uitvoerings datum', 'Uitvoeringsdatum'));

        // Afg. from Status omschr.
        const statusRaw = col(row, 'Status omschr.', 'Status omschr', 'Statusomschrijving', 'Status');
        const statusKey = statusRaw.toLowerCase().trim();
        let afgemeld;
        if (STATUS_TO_AFG.hasOwnProperty(statusKey)) {
            afgemeld = STATUS_TO_AFG[statusKey];
        } else {
            afgemeld = 'Nee';
            if (statusRaw) {
                warnings.push(`WO-nr. ${woNummer || '(leeg)'}: onbekende status "${statusRaw}"`);
            }
        }

        // Ref. from Referentie column
        const refRaw = col(row, 'Referentie');
        const referentie = refRaw ? 'Ingevuld, nakijken' : 'Nee';

        return { regNummer, woNummer, waar, datumAanvang, afgemeld, referentie };
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
            let added = 0, updated = 0, skipped = 0;

            rawRows.forEach(row => {
                const imp = csvRowToRecord(row, warnings);

                if (!imp.woNummer) { skipped++; return; }

                const existing = records.find(r => r.woNummer === imp.woNummer);
                if (existing) {
                    if (imp.regNummer)    existing.regNummer    = imp.regNummer;
                    if (imp.waar)         existing.waar         = imp.waar;
                    if (imp.datumAanvang) existing.datumAanvang = imp.datumAanvang;
                    existing.afgemeld = imp.afgemeld;
                    if (existing.referentie === 'Nee' && imp.referentie !== 'Nee') {
                        existing.referentie = imp.referentie;
                    }
                    updated++;
                } else {
                    records.push({
                        id:            generateId(),
                        regNummer:     imp.regNummer,
                        woNummer:      imp.woNummer,
                        waar:          imp.waar,
                        monteur:       '',
                        datumAanvang:  imp.datumAanvang,
                        datumEind:     '',
                        uitgevoerd:    'Nee',
                        afgemeld:      imp.afgemeld,
                        referentie:    imp.referentie,
                        archiefGevuld: 'Ja',
                        vervolg:       'Nee',
                        opmerking:     '',
                    });
                    added++;
                }
            });

            saveRecords();
            expandedGroups.clear();
            renderTable();

            let msg = `Import klaar: ${added} toegevoegd, ${updated} bijgewerkt`;
            if (skipped) msg += `, ${skipped} overgeslagen (geen WO-nr.)`;
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

    // Initial render
    renderTable();
    initColumnResize();
});
