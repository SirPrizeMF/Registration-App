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

    // Load records from localStorage
    function loadRecords() {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
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

    // Render table
    function renderTable() {
        tableBody.innerHTML = '';

        if (records.length === 0) {
            const tr = document.createElement('tr');
            tr.className = 'empty-state';
            tr.innerHTML = `<td colspan="13">Geen records gevonden. Klik op "+ Nieuw Record" om te beginnen.</td>`;
            tableBody.appendChild(tr);
        } else {
            records.forEach(record => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(record.regNummer)}</td>
                    <td>${escapeHtml(record.woNummer)}</td>
                    <td>${escapeHtml(record.waar)}</td>
                    <td>${escapeHtml(record.monteur)}</td>
                    <td>${formatDate(record.datumAanvang)}</td>
                    <td>${formatDate(record.datumEind)}</td>
                    <td class="cell-check">${record.uitgevoerd ? '\u2705' : '\u2014'}</td>
                    <td class="cell-check">${record.afgemeld ? '\u2705' : '\u2014'}</td>
                    <td>${escapeHtml(record.referentie)}</td>
                    <td class="cell-check">${record.archief ? '\u2705' : '\u2014'}</td>
                    <td>${escapeHtml(record.vervolg)}</td>
                    <td>${escapeHtml(record.opmerking)}</td>
                    <td class="cell-actions">
                        <button class="btn btn-edit" data-id="${record.id}">Bewerk</button>
                        <button class="btn btn-danger" data-id="${record.id}">Verwijder</button>
                    </td>
                `;
                tableBody.appendChild(tr);
            });
        }

        updateRowCount();
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Update row count display
    function updateRowCount() {
        const count = records.length;
        rowCount.textContent = `${count} record${count !== 1 ? 's' : ''}`;
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
            uitgevoerd: document.getElementById('uitgevoerd').checked,
            afgemeld: document.getElementById('afgemeld').checked,
            referentie: document.getElementById('referentie').value.trim(),
            archief: document.getElementById('archief').checked,
            vervolg: document.getElementById('vervolg').value.trim(),
            opmerking: document.getElementById('opmerking').value.trim(),
        };
    }

    // Populate form with record data
    function populateForm(record) {
        document.getElementById('regNummer').value = (record.regNummer || '').replace(REG_PREFIX, '');
        document.getElementById('woNummer').value = (record.woNummer || '').replace(WO_PREFIX, '');
        document.getElementById('waar').value = record.waar || '';
        document.getElementById('monteur').value = record.monteur || '';
        document.getElementById('datumAanvang').value = record.datumAanvang || '';
        document.getElementById('datumEind').value = record.datumEind || '';
        document.getElementById('uitgevoerd').checked = record.uitgevoerd || false;
        document.getElementById('afgemeld').checked = record.afgemeld || false;
        document.getElementById('referentie').value = record.referentie || '';
        document.getElementById('archief').checked = record.archief || false;
        document.getElementById('vervolg').value = record.vervolg || '';
        document.getElementById('opmerking').value = record.opmerking || '';
    }

    // Generate unique ID
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

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

    // Event: Edit or Delete via table delegation
    tableBody.addEventListener('click', (e) => {
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

    // Initial render
    renderTable();
});
