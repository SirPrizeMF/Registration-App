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

    // Priority rankings for status fields (lower index = worse)
    const STATUS_RANK = {
        uitgevoerd:    ['Nee', 'Bezig', 'Ja', 'Vervallen'],
        afgemeld:      ['Nee', 'Ja'],
        referentie:    ['Nee', 'Ja', 'Onnodig'],
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
            referentie:   { green: ['Ja', 'Onnodig'], red: ['Nee'] },
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

    // Build a single data-row's inner HTML
    function buildRowCells(record, isChild) {
        const sc = calculateScore(record);
        const regCell = isChild
            ? `<td class="score-${sc} child-indent"></td>`
            : `<td class="score-${sc}">${escapeHtml(record.regNummer)}</td>`;
        return `
            ${regCell}
            <td class="score-${sc}">${escapeHtml(record.woNummer)}</td>
            <td class="score-${sc}">${escapeHtml(record.waar)}</td>
            <td class="score-${sc}">${escapeHtml(record.monteur)}</td>
            <td class="score-${sc}">${formatDate(record.datumAanvang)}</td>
            <td class="score-${sc}">${formatDate(record.datumEind)}</td>
            <td class="cell-status ${statusColor('uitgevoerd', record.uitgevoerd)}">${escapeHtml(record.uitgevoerd)}</td>
            <td class="cell-status ${statusColor('afgemeld', record.afgemeld)}">${escapeHtml(record.afgemeld)}</td>
            <td class="cell-status ${statusColor('referentie', record.referentie)}">${escapeHtml(record.referentie)}</td>
            <td class="cell-status ${statusColor('archiefGevuld', record.archiefGevuld)}">${escapeHtml(record.archiefGevuld)}</td>
            <td class="cell-status ${statusColor('vervolg', record.vervolg)}">${escapeHtml(record.vervolg)}</td>
            <td class="cell-opmerking" title="${escapeHtml(record.opmerking)}">${escapeHtml(record.opmerking)}</td>
            <td class="cell-actions">
                <button class="btn btn-edit" data-id="${record.id}">Bewerk</button>
                <button class="btn btn-danger" data-id="${record.id}">Verwijder</button>
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

                // For multi-record groups, compute worst status values
                const summary = hasMultiple ? groupSummary(recs) : null;
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
                    <td class="score-${sc}">${escapeHtml(first.monteur)}</td>
                    <td class="score-${sc}">${formatDate(first.datumAanvang)}</td>
                    <td class="score-${sc}">${formatDate(first.datumEind)}</td>
                    <td class="cell-status ${statusColor('uitgevoerd', dispUitg)}">${escapeHtml(dispUitg)}</td>
                    <td class="cell-status ${statusColor('afgemeld', dispAfg)}">${escapeHtml(dispAfg)}</td>
                    <td class="cell-status ${statusColor('referentie', dispRef)}">${escapeHtml(dispRef)}</td>
                    <td class="cell-status ${statusColor('archiefGevuld', dispArchief)}">${escapeHtml(dispArchief)}</td>
                    <td class="cell-status ${statusColor('vervolg', dispVervolg)}">${escapeHtml(dispVervolg)}</td>
                    <td class="cell-opmerking" title="${escapeHtml(first.opmerking)}">${escapeHtml(first.opmerking)}</td>
                    <td class="cell-actions">
                        <button class="btn btn-edit" data-id="${first.id}">Bewerk</button>
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

        if (btn.classList.contains('btn-edit')) {
            const record = records.find(r => r.id === id);
            if (record) {
                editingId = id;
                populateForm(record);
                openModal('Record Bewerken');
            }
        }

        if (btn.classList.contains('btn-danger')) {
            if (confirm('Weet je zeker dat je dit record wilt verwijderen?')) {
                records = records.filter(r => r.id !== id);
                saveRecords();
                renderTable();
            }
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

    // Initial render
    renderTable();
    initColumnResize();
});
