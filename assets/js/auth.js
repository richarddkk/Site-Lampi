"use strict";

const auth = firebase.auth();
const loginForm = document.getElementById("form-login");
const protectedPage = !loginForm && !["", "index.html"].includes(location.pathname.split("/").pop());
const accessMessage = document.getElementById("login-error");

function showAccessError(message) {
    if (accessMessage) accessMessage.textContent = message;
}

window.lampiAdminReady = new Promise(resolve => {
    auth.onAuthStateChanged(async user => {
        if (!protectedPage) return resolve(false);
        if (!user) {
            location.replace("login.html");
            return resolve(false);
        }
        try {
            const role = (await db.collection("lampi_access").doc(user.uid).get()).data()?.role;
            if (role === "admin") return resolve(true);
            document.querySelector("main")?.replaceChildren("Esta conta não tem acesso ao painel do site.");
        } catch {
            document.querySelector("main")?.replaceChildren("Não foi possível verificar o acesso. Confira a conexão e recarregue a página.");
        }
        resolve(false);
    });
});

loginForm?.addEventListener("submit", async event => {
    event.preventDefault();
    showAccessError("");
    const button = loginForm.querySelector("button");
    button.disabled = true;
    try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
        const { user } = await auth.signInWithEmailAndPassword(
            document.getElementById("login-user").value.trim(),
            document.getElementById("login-pass").value
        );
        const role = (await db.collection("lampi_access").doc(user.uid).get()).data()?.role;
        if (role !== "admin") {
            await auth.signOut();
            showAccessError("Esta conta não está cadastrada como administradora.");
            return;
        }
        location.replace("chamada.html");
    } catch (error) {
        showAccessError(error.code === "auth/network-request-failed"
            ? "Sem conexão com o Firebase."
            : "E-mail, senha ou permissão inválida. Confira a configuração do Firebase Authentication.");
    } finally {
        button.disabled = false;
    }
});

window.logout = async () => {
    await auth.signOut();
    location.replace("login.html");
};
