// ==========================================
// SISTEMA DE LOGIN E CONTROLE DE SESSÃO
// ==========================================

const allowedUsers = {
    "Richard": "pimenta06",
    "Murilo": "143.266.070-28", // Substitua pela senha real
    "Gabriel": "6545"
};

// Descobre em qual página o usuário está no momento
const currentPage = window.location.pathname.split("/").pop() || "index.html";
const isLoggedIn = sessionStorage.getItem("lampi_logged_in");

const publicPages = ["login.html", "index.html", ""];

// Redirecionamento automático caso não esteja logado
if (!isLoggedIn && !publicPages.includes(currentPage)) {
    window.location.href = "login.html";
}

// Lógica exclusiva para o formulário de Login
if (document.getElementById('login-page')) {
    const loginForm = document.getElementById('form-login');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const user = document.getElementById('login-user').value.trim();
            const pass = document.getElementById('login-pass').value.trim();

            if (allowedUsers[user] && allowedUsers[user] === pass) {
                sessionStorage.setItem("lampi_logged_in", user);
                window.location.href = "index.html";
            } else {
                alert("Usuário ou senha incorretos!");
            }
        });
    }
}

// Função de Sair (Logout) acessível globalmente
window.logout = function() {
    sessionStorage.removeItem("lampi_logged_in");
    window.location.href = "login.html";
};