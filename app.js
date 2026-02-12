document.addEventListener('DOMContentLoaded', () => {
    const STORAGE_KEY = 'registrationAppData';
    const MAPPING_STORAGE_KEY = 'registrationAppStatusMapping';
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

    // ── CSV Import ───────────────────────────────────────────────────────

    const csvFileInput = document.getElementById('csvFileInput');
    const importResultsModal = document.getElementById('importResultsModal');
    const importResultsClose = document.getElementById('importResultsClose');
    const importResultsOverlay = document.getElementById('importResultsOverlay');
    const importResultsContent = document.getElementById('importResultsContent');

    // Detect CSV delimiter (comma vs semicolon) from first line
    function detectDelimiter(text) {
        const firstLine = text.split('\n')[0];
        const commas = (firstLine.match(/,/g) || []).length;
        const semicolons = (firstLine.match(/;/g) || []).length;
        return semicolons > commas ? ';' : ',';
    }

    // Parse a single CSV line, respecting double-quoted fields
    function parseCSVLine(line, delimiter) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (ch === delimiter && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    }

    // Parse full CSV text into an array of row objects keyed by header name
    function parseCSV(text) {
        const delim = detectDelimiter(text);
        const lines = text.trim().split(/\r?\n/);
        if (lines.length < 2) return [];
        const headers = parseCSVLine(lines[0], delim).map(h => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = parseCSVLine(lines[i], delim);
            const row = {};
            headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
            rows.push(row);
        }
        return rows;
    }

    // Convert DD-MM-YYYY (or D-M-YYYY) to YYYY-MM-DD; pass through ISO dates unchanged
    function parseDutchDate(dateStr) {
        if (!dateStr) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
        const m = dateStr.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        return '';
    }

    // Load the Status omschr. → afgemeld mapping from localStorage (or built-in defaults)
    function loadStatusMapping() {
        const data = localStorage.getItem(MAPPING_STORAGE_KEY);
        if (data) return JSON.parse(data);
        return {
            ja:  ['gereed niet gefactureerd', 'factuur gejournaliseerd', 'administratief gereed', '1e werkorder gereed'],
            nee: ['aangemaakt'],
        };
    }

    function saveStatusMapping(mapping) {
        localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(mapping));
    }

    let statusMapping = loadStatusMapping();

    // Decide afgemeld value from "Status omschr." column using the current statusMapping
    function mapStatusOmschr(statusOmschr, woNummer) {
        const norm = statusOmschr.toLowerCase().trim();
        if (statusMapping.ja.includes(norm))  return { value: 'Ja',  warning: null };
        if (statusMapping.nee.includes(norm)) return { value: 'Nee', warning: null };
        return {
            value: null,
            warning: `Onbekende status "${statusOmschr}" voor WO-nr. ${woNummer} — Afg. handmatig instellen.`,
        };
    }

    // Map one CSV row to the fields this app cares about
    function mapCsvRow(row) {
        const woNummer = (row['Werkordernummer'] || '').trim();
        const statusOmschr = (row['Status omschr.'] || '').trim();

        let waar = (row['Dossier'] || '').trim();
        if (waar.startsWith('NRC-')) waar = waar.slice(4);

        const { value: afgemeldValue, warning } = mapStatusOmschr(statusOmschr, woNummer);

        const refRaw = (row['Referentie'] || '').trim();
        const referentie = refRaw === '' ? 'Nee' : 'Ingevuld, nakijken';

        return {
            regNummer:    (row['Registratienr.'] || '').trim(),
            woNummer,
            waar,
            datumAanvang: parseDutchDate((row['Uitvoerings datum'] || '').trim()),
            afgemeld:     afgemeldValue, // null when a warning was raised
            referentie,
            warning,
        };
    }

    // Apply the mapped CSV rows to the records array; return a results summary
    function importCSVData(csvRows) {
        let added = 0;
        let updated = 0;
        let skipped = 0;
        const warnings = [];

        csvRows.forEach(csvRow => {
            const mapped = mapCsvRow(csvRow);
            if (!mapped.woNummer) { skipped++; return; }
            if (mapped.warning) warnings.push(mapped.warning);

            const existing = records.find(r =>
                r.woNummer === mapped.woNummer || r.regNummer === mapped.regNummer
            );

            if (existing) {
                let changed = false;

                // datumAanvang: overwrite when CSV has a non-empty value
                if (mapped.datumAanvang !== '' && mapped.datumAanvang !== existing.datumAanvang) {
                    existing.datumAanvang = mapped.datumAanvang;
                    changed = true;
                }

                // afgemeld: overwrite only when we have a concrete mapped value
                if (mapped.afgemeld !== null && mapped.afgemeld !== existing.afgemeld) {
                    existing.afgemeld = mapped.afgemeld;
                    changed = true;
                }

                // referentie: only overwrite "Nee" → "Ingevuld, nakijken"
                if (existing.referentie === 'Nee' && mapped.referentie === 'Ingevuld, nakijken') {
                    existing.referentie = 'Ingevuld, nakijken';
                    changed = true;
                }

                if (changed) updated++;
            } else {
                records.push({
                    id:           generateId(),
                    regNummer:    mapped.regNummer,
                    woNummer:     mapped.woNummer,
                    waar:         mapped.waar,
                    monteur:      '',
                    datumAanvang: mapped.datumAanvang,
                    datumEind:    '',
                    uitgevoerd:   'Nee',
                    afgemeld:     mapped.afgemeld !== null ? mapped.afgemeld : 'Nee',
                    referentie:   mapped.referentie,
                    archiefGevuld: 'Nee',
                    vervolg:      'Nee',
                    opmerking:    '',
                });
                added++;
            }
        });

        return { added, updated, skipped, warnings };
    }

    // Render import results inside the modal and open it
    function showImportResults(results) {
        let html = `<div class="import-summary">`;
        html += `<p><strong>${results.added}</strong> nieuw${results.added !== 1 ? 'e' : ''} record${results.added !== 1 ? 's' : ''} toegevoegd.</p>`;
        html += `<p><strong>${results.updated}</strong> bestaand${results.updated !== 1 ? 'e' : ''} record${results.updated !== 1 ? 's' : ''} bijgewerkt.</p>`;
        if (results.skipped > 0) {
            html += `<p class="import-skipped">${results.skipped} rij${results.skipped !== 1 ? 'en' : ''} overgeslagen (geen WO-nummer).</p>`;
        }
        if (results.warnings.length > 0) {
            html += `<div class="import-warnings">`;
            html += `<p class="warning-title"><strong>Waarschuwingen (${results.warnings.length}) — handmatig instellen:</strong></p>`;
            html += `<ul class="warning-list">`;
            results.warnings.forEach(w => { html += `<li>${escapeHtml(w)}</li>`; });
            html += `</ul></div>`;
        }
        html += `</div>`;
        importResultsContent.innerHTML = html;
        importResultsModal.classList.remove('hidden');
    }

    function closeImportResults() {
        importResultsModal.classList.add('hidden');
    }

    // Event: open file picker
    document.getElementById('importCsvBtn').addEventListener('click', () => {
        csvFileInput.value = '';
        csvFileInput.click();
    });

    // Event: file selected — parse and import
    csvFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            let text = ev.target.result;
            // Strip UTF-8 BOM if present (common in Excel CSV exports)
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            try {
                const csvRows = parseCSV(text);
                if (csvRows.length === 0) {
                    alert('Het CSV-bestand is leeg of kon niet worden gelezen.');
                    return;
                }
                const results = importCSVData(csvRows);
                saveRecords();
                renderTable();
                showImportResults(results);
            } catch (err) {
                alert('Fout bij het verwerken van het CSV-bestand: ' + err.message);
            }
        };
        reader.readAsText(file, 'UTF-8');
    });

    // ── Reference CSV (status mapping) ──────────────────────────────────

    const refCsvInput = document.getElementById('refCsvFileInput');
    const refCsvBtn   = document.getElementById('refCsvBtn');

    function updateRefBtnLabel() {
        const total = statusMapping.ja.length + statusMapping.nee.length;
        refCsvBtn.textContent = total > 0
            ? `Reference (${total})`
            : 'Reference laden';
    }
    updateRefBtnLabel();

    refCsvBtn.addEventListener('click', () => {
        refCsvInput.value = '';
        refCsvInput.click();
    });

    refCsvInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            let text = ev.target.result;
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            try {
                const rows = parseCSV(text);
                if (rows.length === 0) {
                    alert('Het referentie-bestand is leeg of kon niet worden gelezen.');
                    return;
                }
                // Find columns by name (case-insensitive)
                const keys = Object.keys(rows[0]);
                const statusCol   = keys.find(k => k.toLowerCase().includes('status'));
                const afgemeldCol = keys.find(k => k.toLowerCase().includes('afg'));
                if (!statusCol || !afgemeldCol) {
                    alert(
                        'Verwachte kolommen niet gevonden in het referentie-bestand.\n' +
                        'Zorg voor een kolom met "Status" (bijv. "Status omschr.") ' +
                        'en een kolom met "Afg" (bijv. "Afgemeld").'
                    );
                    return;
                }
                const newMapping = { ja: [], nee: [] };
                rows.forEach(row => {
                    const status   = (row[statusCol]   || '').trim().toLowerCase();
                    const afgemeld = (row[afgemeldCol] || '').trim().toLowerCase();
                    if (!status) return;
                    if (afgemeld === 'ja')  newMapping.ja.push(status);
                    else if (afgemeld === 'nee') newMapping.nee.push(status);
                });
                statusMapping = newMapping;
                saveStatusMapping(newMapping);
                updateRefBtnLabel();
                alert(
                    `Reference geladen:\n` +
                    `${newMapping.ja.length} status(sen) → Ja\n` +
                    `${newMapping.nee.length} status(sen) → Nee`
                );
            } catch (err) {
                alert('Fout bij het verwerken van het referentie-bestand: ' + err.message);
            }
        };
        reader.readAsText(file, 'UTF-8');
    });

    importResultsClose.addEventListener('click', closeImportResults);
    importResultsOverlay.addEventListener('click', closeImportResults);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !importResultsModal.classList.contains('hidden')) {
            closeImportResults();
        }
    });

    // Initial render
    renderTable();
    initColumnResize();
});
