// Client Identity Management
function getClientId() {
    let id = localStorage.getItem('clientId');
    if (!id) {
        id = 'client_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        localStorage.setItem('clientId', id);
    }
    return id;
}

const clientId = getClientId();
const socket = io({ query: { clientId } });

// Notify server of our identity and ensure session is active
fetch('/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId })
});

// UI Elements
const waStatus = document.getElementById('wa-status');
const qrSection = document.getElementById('qr-section');
const qrcodeImg = document.getElementById('qrcode');
const qrLoading = document.getElementById('qr-loading');
const logsContainer = document.getElementById('logs-container');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');

const tabBtns = document.querySelectorAll('.tab-btn');
const forms = document.querySelectorAll('.form-container');

const btnCheckSingle = document.getElementById('btn-check-single');
const singleNumber = document.getElementById('single-number');

const btnCheckBulk = document.getElementById('btn-check-bulk');
const btnStopBulk = document.getElementById('btn-stop-bulk');
const bulkNumbers = document.getElementById('bulk-numbers');
const fileUpload = document.getElementById('file-upload');
const fileNameDisplay = document.getElementById('file-name');

// UI Elements (Results)
const activeList = document.getElementById('active-list');
const businessList = document.getElementById('business-list');
const inactiveList = document.getElementById('inactive-list');

const activeCount = document.getElementById('active-count');
const businessCount = document.getElementById('business-count');
const inactiveCount = document.getElementById('inactive-count');

const btnCopyActive = document.getElementById('btn-copy-active');
const btnCopyBusiness = document.getElementById('btn-copy-business');
const btnCopyInactive = document.getElementById('btn-copy-inactive');

let countActive = 0;
let countBusiness = 0;
let countInactive = 0;
let totalChecks = 0;
let currentChecks = 0;

// Tab Switching logic
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        forms.forEach(f => f.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
    });
});

// Socket Events
socket.on('status', (data) => {
    if (data.status === 'connected') {
        waStatus.textContent = 'CONNECTED';
        waStatus.className = 'status-connected';
        qrcodeImg.style.display = 'none';
        qrLoading.style.display = 'none';
        document.querySelector('.sys-msg').textContent = 'System is ready.';
    } else {
        waStatus.textContent = 'DISCONNECTED';
        waStatus.className = 'status-disconnected';
        qrcodeImg.style.display = 'none';
        qrLoading.style.display = 'block';
        document.querySelector('.sys-msg').textContent = 'Waiting for WhatsApp Engine...';
    }
});

socket.on('qr', (url) => {
    if (url) {
        qrcodeImg.src = url;
        qrcodeImg.style.display = 'block';
        qrLoading.style.display = 'none';
        document.querySelector('.sys-msg').textContent = 'Scan QR Code below:';
    } else {
        qrcodeImg.style.display = 'none';
    }
});

socket.on('log', (data) => {
    const logLine = document.createElement('div');
    logLine.className = `log-line ${data.type}`;
    const timestamp = new Date().toLocaleTimeString();
    logLine.textContent = `[${timestamp}] ${data.message}`;
    
    logsContainer.appendChild(logLine);
    logsContainer.scrollTop = logsContainer.scrollHeight; // auto-scroll
});

socket.on('check_result', (data) => {
    addResult(data);
    
    // Update progress bar tracking if tracking bulk
    if (totalChecks > 0) {
        currentChecks++;
        const percent = Math.round((currentChecks / totalChecks) * 100);
        progressBar.style.width = percent + '%';
        progressText.textContent = `Checking ${currentChecks} / ${totalChecks}...`;
        if (currentChecks >= totalChecks) {
            setTimeout(() => { progressContainer.style.display = 'none'; }, 1000);
            btnStopBulk.style.display = 'none';
            totalChecks = 0;
        }
    }
});

// Result Output Helper
function addResult(data) {
    const { number, exists, bio, isBusiness, isVerified } = data;
    
    if (exists) {
        if (isBusiness) {
            businessList.value += (businessList.value ? '\n' : '') + number;
            countBusiness++;
            businessCount.textContent = countBusiness;
            businessList.scrollTop = businessList.scrollHeight;
        } else {
            activeList.value += (activeList.value ? '\n' : '') + number;
            countActive++;
            activeCount.textContent = countActive;
            activeList.scrollTop = activeList.scrollHeight;
        }
    } else {
        inactiveList.value += (inactiveList.value ? '\n' : '') + number;
        countInactive++;
        inactiveCount.textContent = countInactive;
        inactiveList.scrollTop = inactiveList.scrollHeight;
    }
}

// Copy Handlers
btnCopyActive.addEventListener('click', () => {
    if (!activeList.value) return;
    navigator.clipboard.writeText(activeList.value);
    const originalText = btnCopyActive.textContent;
    btnCopyActive.textContent = '[ COPIED! ]';
    setTimeout(() => btnCopyActive.textContent = originalText, 2000);
});

btnCopyBusiness.addEventListener('click', () => {
    if (!businessList.value) return;
    navigator.clipboard.writeText(businessList.value);
    const originalText = btnCopyBusiness.textContent;
    btnCopyBusiness.textContent = '[ COPIED! ]';
    setTimeout(() => btnCopyBusiness.textContent = originalText, 2000);
});

btnCopyInactive.addEventListener('click', () => {
    if (!inactiveList.value) return;
    navigator.clipboard.writeText(inactiveList.value);
    const originalText = btnCopyInactive.textContent;
    btnCopyInactive.textContent = '[ COPIED! ]';
    setTimeout(() => btnCopyInactive.textContent = originalText, 2000);
});

// Check Single
btnCheckSingle.addEventListener('click', async () => {
    const number = singleNumber.value.trim();
    if (!number) return alert('Silakan masukkan nomor!');

    progressContainer.style.display = 'block';
    progressBar.style.width = '50%';
    progressText.textContent = `Checking single number...`;
    
    try {
        const res = await fetch('/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number, clientId })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            alert(data.message || 'Error occurred');
        } else {
            console.log("Check result:", data);
            // Result is now added real-time via socket check_result
        }
    } catch (err) {
        alert('Gagal terhubung ke server');
    } finally {
        setTimeout(() => { progressContainer.style.display = 'none'; }, 1000);
    }
});

// Check Bulk
btnCheckBulk.addEventListener('click', async () => {
    const rawData = bulkNumbers.value.trim();
    if (!rawData) return alert('Silakan masukkan list nomor!');

    const numbers = rawData.split('\n').map(n => n.trim()).filter(n => n.length > 0);
    if (numbers.length === 0) return alert('List nomor kosong!');

    totalChecks = numbers.length;
    currentChecks = 0;
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = `Checking 0 / ${totalChecks}...`;
    btnStopBulk.style.display = 'block';
    
    try {
        const res = await fetch('/check-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ numbers, clientId })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            alert(data.message || 'Error occurred');
        } else {
            console.log("Bulk result output:", data);
            // Results are added real-time via socket check_result
        }
    } catch (err) {
        alert('Terjadi kesalahan atau koneksi terputus.');
    } finally {
        btnStopBulk.style.display = 'none';
    }
});

// Stop Handler
btnStopBulk.addEventListener('click', async () => {
    btnStopBulk.textContent = '[ STOPPING... ]';
    btnStopBulk.disabled = true;
    try {
        await fetch('/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
    } catch (err) {
        console.error('Failed to stop:', err);
    } finally {
        btnStopBulk.textContent = '[ STOP ]';
        btnStopBulk.disabled = false;
        btnStopBulk.style.display = 'none';
        progressContainer.style.display = 'none';
    }
});

// File Upload Handler
fileUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileNameDisplay.textContent = file.name;
    const reader = new FileReader();
    
    reader.onload = (event) => {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON (array of arrays)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Extract numbers (assuming first column or flatten all)
        const numbers = [];
        jsonData.forEach(row => {
            if (row && row.length > 0) {
                // Check each cell in the row for a potential number
                row.forEach(cell => {
                    const val = String(cell).trim();
                    if (val && /^[0-9+]+$/.test(val.replace(/[\s-]/g, ''))) {
                        numbers.push(val);
                    }
                });
            }
        });

        if (numbers.length > 0) {
            bulkNumbers.value = numbers.join('\n');
            alert(`Berhasil mengambil ${numbers.length} nomor dari file.`);
        } else {
            alert('Tidak ditemukan nomor di dalam file tersebut.');
        }
    };
    
    reader.readAsArrayBuffer(file);
});

// Logout Helper
const btnLogout = document.getElementById('btn-logout');
btnLogout.addEventListener('click', async () => {
    if (!confirm('Apakah kamu yakin ingin mereset sesi? Ini akan menghapus folder session dan memutuskan koneksi WhatsApp.')) return;
    
    btnLogout.textContent = '[ RESETTING... ]';
    btnLogout.disabled = true;

    try {
        const res = await fetch('/logout', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
        });
        const data = await res.json();
        
        if (data.status) {
            // Reset UI
            activeList.value = '';
            businessList.value = '';
            inactiveList.value = '';
            countActive = 0;
            countBusiness = 0;
            countInactive = 0;
            activeCount.textContent = '0';
            businessCount.textContent = '0';
            inactiveCount.textContent = '0';
            
            // App state will be updated via socket (status 'disconnected')
            // QR code will appear eventually when connectToWhatsApp finishes
            console.log('Session reset successfully');
        } else {
            alert('Gagal mereset sesi: ' + data.message);
        }
    } catch (err) {
        alert('Terjadi kesalahan saat menghubungi server');
    } finally {
        btnLogout.textContent = '[ RESET_SESSION ]';
        btnLogout.disabled = false;
    }
});
