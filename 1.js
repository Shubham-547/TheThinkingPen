// Form show/hide logic with strict data clearing for Update No. 2
function showForm(formId) {
    // Update No. 2: Sirf input fields ko select karke clear karega (buttons ko nahi chhedega)
    document.querySelectorAll('.input-box input[type="text"], .input-box input[type="email"], .input-box input[type="password"]').forEach(input => {
        input.value = '';
        input.classList.remove('has-val'); // Label ko normal position me lane ke liye
    });

    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById(formId).style.display = 'flex';

    // Check if any auto-filled value exists
    document.querySelectorAll(`#${formId} .input-box input`).forEach(input => {
        if (input.value.trim() !== "") {
            input.classList.add('has-val');
        }
    });
}

// Register Logic
async function handleRegister() {
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    if (!username) {
        // Update No. 3 ke mutabik validation focus yahan handle ho raha hai HTML inline ke sath
        document.getElementById('reg-username').reportValidity();
        return;
    }

    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
    });

    const data = await res.json();
    if (data.success) {
        alert(data.message);
        
        document.getElementById('reg-username').value = '';
        document.getElementById('reg-email').value = '';
        document.getElementById('reg-password').value = '';
        
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';

        document.querySelectorAll('.input-box input').forEach(input => {
            input.classList.remove('has-val');
        });

        showForm('login-form');
    } else {
        alert(data.message);
    }
}

// Login Logic
async function handleLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (data.success) {
        localStorage.setItem('tch_token', data.token || 'logged_in_session_token'); 
        window.location.href = data.redirect;
    } else if (data.redirect === "register") {
        alert(data.message);
        showForm('register-form');
        document.getElementById('reg-email').value = email;
    } else {
        alert(data.message);
    }
}

// Google Login / Register Redirect
function loginWithGoogle(intent) {
    if (intent === 'register') {
        const usernameInput = document.getElementById('reg-username');
        const username = usernameInput.value.trim();
        
        // Update No. 3: Prompt alert hatakar standard browser requirement validation trigger ki
        if (!username) {
            usernameInput.setCustomValidity("Please fill out this field.");
            usernameInput.reportValidity();
            return;
        }
        window.location.href = "/login/google?intent=register&username=" + encodeURIComponent(username);
    } else {
        window.location.href = "/login/google?intent=login";
    }
}

// Handle the bounce-back from Google
(function handleRedirectParams() {
    const params = new URLSearchParams(window.location.search);

    if (params.get('showRegister') === '1') {
        showForm('register-form');
        const prefillEmail = params.get('prefillEmail');
        if (prefillEmail) {
            document.getElementById('reg-email').value = prefillEmail;
        }
        alert("This Google account is not registered yet. Please complete registration.");
    }

    const googleMsg = params.get('googleMsg');
    if (googleMsg === 'already_registered') {
        alert("This email is already registered.");
        showForm('login-form');
    } else if (googleMsg === 'registered_success') {
        alert("Account registered successfully. Please log in.");
        showForm('login-form');
    }

    const error = params.get('error');
    if (error === 'auth_failed') {
        alert("Google sign-in failed. Please try again.");
    } else if (error === 'no_email') {
        alert("Could not get your email from Google. Please try again.");
    }

    if (params.toString()) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }
})();

// Update No. 1: Input focus aur blur ke rules jo label ko desktop aur mobile dono par lock rakhein
document.querySelectorAll('.input-box input').forEach(input => {
    // Jab user click kare ya mobile par touch kare (Focus mode)
    input.addEventListener('focus', function() {
        this.classList.add('has-val');
    });

    // Jab touch ya click bahar chala jaye (Blur mode)
    input.addEventListener('blur', function() {
        if (this.value.trim() !== "") {
            this.classList.add('has-val'); // Agar text bhara hai to upar hi rahega
        } else {
            this.classList.remove('has-val'); // Agar khali hai tabhi neeche aayega
        }
    });
});

// Profile page load logic
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const res = await fetch('/api/user/check-admin');
        const data = await res.json();
        
        if (data.isAdmin) {
            const profileContainer = document.querySelector('.profile-container');
            if (profileContainer) {
                const adminBtn = document.createElement('button');
                adminBtn.innerText = "🛡️ Open Admin Control Panel";
                adminBtn.className = "btn admin-btn";
                adminBtn.style.backgroundColor = "red";
                adminBtn.style.marginTop = "20px";
                
                adminBtn.onclick = () => {
                    window.location.href = "admin-dashboard.html";
                };
                
                profileContainer.appendChild(adminBtn);
            }
        }
    } catch (err) {
        console.error("Admin check failed", err);
    }
});