// A configuração pública identifica o projeto. O acesso é controlado por Auth e firestore.rules.
const firebaseConfig = {
    apiKey: "AIzaSyDXr0MHWkmxfVtGzBkRyM_JZbB670D-TdM",
    authDomain: "lampi-2bf7f.firebaseapp.com",
    projectId: "lampi-2bf7f",
    storageBucket: "lampi-2bf7f.appspot.com",
    messagingSenderId: "1042682574061",
    appId: "1:1042682574061:web:456bc45f299c1fbd2548e4",
    measurementId: "G-HG9MP3H4S9"
};


firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
window.dbAPI = {
    async getDoc(collection, id) {
        const snap = await db.collection(collection).doc(id).get();
        return snap.exists ? snap.data() : null;
    },
    async setDoc(collection, id, data) {
        await db.collection(collection).doc(id).set(data, { merge: true });
        return true;
    }
};
