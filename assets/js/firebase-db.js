// ==========================================
// FIREBASE & BANCO DE DADOS (FIRESTORE)
// ==========================================

// Configuração do seu app fornecida pelo Console
const firebaseConfig = {
    apiKey: "AIzaSyDXr0MHWkmxfVtGzBkRyM_JZbB670D-TdM",
    authDomain: "lampi-2bf7f.firebaseapp.com",
    projectId: "lampi-2bf7f",
    storageBucket: "lampi-2bf7f.appspot.com",
    messagingSenderId: "1042682574061",
    appId: "1:1042682574061:web:456bc45f299c1fbd2548e4",
    measurementId: "G-HG9MP3H4S9"
};

// Inicializa o Firebase e o Banco de Dados (Firestore) via SDK Compat
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Funções globais auxiliares do Banco de Dados
window.dbAPI = {
    // Busca dados de um documento específico no Firestore
    getDoc: async function(collection, docId) {
        try {
            const docRef = await db.collection(collection).doc(docId).get();
            return docRef.exists ? docRef.data() : null;
        } catch (e) {
            console.error("Erro ao buscar documento:", e);
            return null;
        }
    },
    
    // Salva ou atualiza um documento no Firestore
    setDoc: async function(collection, docId, data) {
        try {
            await db.collection(collection).doc(docId).set(data, { merge: true });
            return true;
        } catch (e) {
            console.error("Erro ao salvar documento:", e);
            alert("Erro de permissão no Firebase! Verifique se o Firestore está no Modo de Teste.");
            return false;
        }
    }
};