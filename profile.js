// ============================================================
// TheCodeHub - Secure Connected Profile Script
// ============================================================

document.addEventListener("DOMContentLoaded", initializeProfileData);

// Menu bahar click karne par band hona chahiye.
document.addEventListener('click', (e) => {
    const container = document.querySelector('.avatar-container-block');
    const menu = document.getElementById('avatarMenu');
    if (container && !container.contains(e.target) && menu) {
        menu.classList.remove('active');
    }
});

async function initializeProfileData() {
    // Sabse pehle UI ko blank karein
    const displayNameEl = document.getElementById('display-name');
    if (displayNameEl) displayNameEl.innerText = '';
    
    document.getElementById('user-username').innerText = '';
    document.getElementById('user-id').innerText = '';
    document.getElementById('user-email').innerText = '';
    document.getElementById('user-joined').innerText = '';
    document.getElementById('admin-badge').style.display = 'none';

    try {
        // Backend (Database) se real data mangwana
        const response = await fetch('/api/user/profile-data');
        const data = await response.json();
        
        if (data.success) {
            // Avatar aur Asli Naam set karna
            document.getElementById('profile-avatar').src = data.avatarUrl || 'default-avatar.png';
            if (displayNameEl) displayNameEl.innerText = data.username;
            
            // Niche list mein Real Data set karna
            document.getElementById('user-username').innerText = data.username;
            document.getElementById('user-id').innerText = data.databaseId; // Permanent Unique ID
            document.getElementById('user-email').innerText = data.email;
            
            // Date formatting
            const joinDate = data.joinedDate ? new Date(data.joinedDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
            document.getElementById('user-joined').innerText = joinDate;

            // Admin Badge ab backend ke /api/user/check-admin se decide hoga (multiple admins support karta hai)
            checkAndShowAdminPanel();

        } else {
            // Agar user logged in nahi hai, toh wapas login page pe bhejo
            window.location.href = '/';
        }
    } catch (error) {
        console.error("Connection error:", error);
    }
}

// ================= ADMIN PANEL VISIBILITY (Backend-verified) =================
// Important: ye sirf UI dikhane/chhupane ke liye hai. Real security backend
// ke requireAdmin/requireSuperAdmin middleware mein hai — koi bhi frontend
// trick (devtools se isAdmin true karna) actual admin APIs ko bypass nahi kar sakti.
async function checkAndShowAdminPanel() {
    try {
        const res = await fetch('/api/user/check-admin');
        const data = await res.json();
        if (data.isAdmin) {
            document.getElementById('admin-badge').style.display = 'inline-block';
            const adminPanel = document.getElementById('admin-panel-card');
            if (adminPanel) adminPanel.style.display = 'block';
        }
    } catch (err) {
        console.error("Admin check failed", err);
    }
}

// ================= AVATAR SYSTEM LOGIC =================
function toggleAvatarMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('avatarMenu');
    if (menu) menu.classList.toggle('active');
}

function viewPhoto() {
    const src = document.getElementById('profile-avatar').src;
    window.open(src, '_blank');
    document.getElementById('avatarMenu').classList.remove('active');
}

// Hidden input banana aur file picker open karna
function triggerImage_Upload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*'; // Strict Browser hint
    input.onchange = (event) => uploadNew_Avatar(event);
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
    document.getElementById('avatarMenu').classList.remove('active');
}

// File validation and Database Upload
async function uploadNew_Avatar(event) {
    const file = event.target.files[0];
    if (!file) return;

    // VALIDATION: Sirf image files allow karni hain
    if (!file.type.startsWith('image/')) {
        alert("Only images can be uploaded.");
        return;
    }
    
    displayToastMessage("Uploading photo...");

    // Turant screen par dikhane ke liye local preview
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('profile-avatar').src = e.target.result;
    }
    reader.readAsDataURL(file);

    // Asli photo server par bhejna
    const formData = new FormData();
    formData.append('avatar', file);
    try {
        const res = await fetch('/api/user/update-avatar', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            document.getElementById('profile-avatar').src = data.newAvatarUrl;
            displayToastMessage("✅ Photo uploaded securely to Database!");
        } else {
            displayToastMessage("❌ Upload failed!");
        }
    } catch (err) {
        displayToastMessage("❌ Server error.");
    }
}

function triggerImageUpload() {
    triggerImage_Upload();
}

// Database se image Remove aur history preserve karna
async function removeAvatar() {
    displayToastMessage("Removing photo...");
    try {
        const res = await fetch('/api/user/remove-avatar', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            document.getElementById('profile-avatar').src = 'default-avatar.png';
            document.getElementById('avatarMenu').classList.remove('active');
            displayToastMessage("🗑️ Photo removed successfully.");
        } else {
            displayToastMessage("❌ Error removing photo.");
        }
    } catch (err) {
        displayToastMessage("❌ Server connection lost.");
    }
}

// ================= LOGOUT SYSTEM =================
async function executeLogout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {}
    
    displayToastMessage("🚪 Logged out successfully!");
    setTimeout(() => { 
        window.location.href = '/'; 
    }, 1500);
}

function displayToastMessage(messageText) {
    const toastWrapper = document.getElementById('toast');
    if (toastWrapper) {
        toastWrapper.innerHTML = messageText;
        toastWrapper.classList.add('show');
        setTimeout(() => { 
            toastWrapper.classList.remove('show'); 
        }, 2500);
    }
}