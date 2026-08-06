// ==========================================
// SISTEMA DE LOGIN SEGURO (HASH SHA-256)
// ==========================================

// Lista de usuários com senhas criptografadas em SHA-256
// Ninguém no GitHub consegue ler qual é a senha original olhando esses códigos!
const secureUsers = {
    "Richard": "3521b90219cf308e2dc70d3f4d7023e13f7ede595d237942e43b0427ddddd718", // Exemplo de hash
    "Murilo": "c194211507af667bfc74a5926c48427f09bbfdd810b9060ceeaba5f4bd9a593e",
    "Gabriel":  "983adc986531868a9ef48446fd07d5751982f6336ee073b10512d6568ad149e1"
};

// Função nativa do navegador para transformar qualquer texto em Hash SHA-256
async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Controle de rotas e acesso
const currentPage = window.location.pathname.split("/").pop() || "index.html";
const isLoggedIn = sessionStorage.getItem("lampi_logged_in");
const publicPages = ["login.html", "index.html", ""];

if (!isLoggedIn && !publicPages.includes(currentPage)) {
    window.location.href = "login.html";
}

// Lógica de Login validando por Hash Criptográfico
if (document.getElementById('login-page')) {
    const loginForm = document.getElementById('form-login');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const user = document.getElementById('login-user').value.trim();
            const pass = document.getElementById('login-pass').value.trim();

            if (secureUsers[user]) {
                const inputHash = await hashPassword(pass);
                if (secureUsers[user] === inputHash) {
                    sessionStorage.setItem("lampi_logged_in", user);
                    window.location.href = "index.html";
                    return;
                }
            }
            alert("Usuário ou senha incorretos!");
        });
    }
}

window.logout = function() {
    sessionStorage.removeItem("lampi_logged_in");
    window.location.href = "login.html";
};