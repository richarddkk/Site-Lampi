// Projetos e inventário mantêm os documentos originais do Firestore.
function reportDataError(error) {
    console.error(error);
    alert("Não foi possível acessar ou salvar no Firebase. Confira a conexão e as permissões.");
}

window.lampiAdminReady.then((admin) => {
if (!admin) return;
function escapeHTML(value) {
    const node = document.createElement("span");
    node.textContent = String(value ?? "");
    return node.innerHTML;
}
// --- GERENCIAMENTO DE PROJETOS ---
if (document.getElementById('projetos-page')) {
    let editingProjectId = null;
    const grid = document.getElementById('projects-grid');
    const form = document.getElementById('form-add-project');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

    function renderProjects(projects) {
        if (!grid) return;
        grid.innerHTML = '';
        if (projects.length === 0) {
            grid.innerHTML = `<p style="color: var(--text-muted); padding: 1rem;">Nenhum projeto cadastrado no momento.</p>`;
            return;
        }
        projects.forEach(proj => {
            const div = document.createElement('div');
            div.className = 'project-card';
            div.innerHTML = `
                <span class="project-tag">${escapeHTML(proj.tech)}</span>
                <h3>${escapeHTML(proj.title)}</h3>
                <p style="margin-top: 0.5rem; color: var(--text-muted); font-size: 0.95rem;">${escapeHTML(proj.desc)}</p>
                <div style="margin-top: 1.5rem; display: flex; gap: 0.5rem; justify-content: flex-end;">
                    <button class="btn btn-green" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="prepareEditProject(${Number(proj.id)})"><i class="fa-solid fa-edit"></i> Editar</button>
                    <button class="btn" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; background-color: var(--danger);" onclick="deleteProject(${Number(proj.id)})"><i class="fa-solid fa-trash"></i> Excluir</button>
                </div>
            `;
            grid.appendChild(div);
        });
    }

    db.collection("lampi_data").doc("projects_system").onSnapshot(
        (doc) => {
            if (doc.exists) {
                const data = doc.data() || {};
                renderProjects(data.projects || []);
            } else {
                renderProjects([]);
            }
        },
        reportDataError
    );

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            saveForm().catch(reportDataError);
        });
        async function saveForm() {
            const title = document.getElementById('proj-title').value;
            const tech = document.getElementById('proj-tech').value;
            const desc = document.getElementById('proj-desc').value;
            
            const docData = (await dbAPI.getDoc("lampi_data", "projects_system")) || {};
            let projects = docData.projects || [];

            if (editingProjectId) {
                projects = projects.map(p => p.id === editingProjectId ? { id: p.id, title, tech, desc } : p);
                editingProjectId = null;
                if (submitBtn) {
                    submitBtn.innerHTML = "Salvar Projeto";
                    submitBtn.className = "btn btn-green";
                }
            } else {
                projects.push({ id: Date.now(), title, tech, desc });
            }

            await dbAPI.setDoc("lampi_data", "projects_system", { projects: projects });
            form.reset();
        }
    }

    window.deleteProject = id => deleteProject(id).catch(reportDataError);
    async function deleteProject(id) {
        if (confirm("Excluir este projeto permanentemente?")) {
            const docData = (await dbAPI.getDoc("lampi_data", "projects_system")) || {};
            let projects = (docData.projects || []).filter(p => p.id !== id);
            await dbAPI.setDoc("lampi_data", "projects_system", { projects: projects });
        }
    }

    window.prepareEditProject = id => prepareEditProject(id).catch(reportDataError);
    async function prepareEditProject(id) {
        const docData = (await dbAPI.getDoc("lampi_data", "projects_system")) || {};
        const proj = (docData.projects || []).find(p => p.id === id);
        if (proj) {
            document.getElementById('proj-title').value = proj.title;
            document.getElementById('proj-tech').value = proj.tech;
            document.getElementById('proj-desc').value = proj.desc;
            editingProjectId = id;
            if (submitBtn) {
                submitBtn.innerHTML = "<i class='fa-solid fa-floppy-disk'></i> Atualizar Alterações";
                submitBtn.className = "btn"; 
            }
        }
    }
}

// --- GERENCIAMENTO DE INVENTÁRIO (TOMBOS) ---
if (document.getElementById('inventario-page')) {
    let editingInventoryId = null;
    const tbody = document.getElementById('inventory-tbody');
    const form = document.getElementById('form-add-item');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

    function renderInventory(inventory) {
        if (!tbody) return;
        tbody.innerHTML = '';
        if (inventory.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">Nenhum equipamento registrado ainda.</td></tr>`;
            return;
        }
        inventory.forEach(item => {
            const statusClass = item.status === 'Disponível' ? 'status-presente' : 'status-ausente';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHTML(item.tombo)}</strong></td>
                <td>${escapeHTML(item.name)}</td>
                <td><span class="status-badge ${statusClass}">${escapeHTML(item.status)}</span></td>
                <td>${escapeHTML(item.user)}</td>
                <td>
                    <div style="display: flex; gap: 0.25rem;">
                        <button class="btn btn-green" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="prepareEditInventory(${Number(item.id)})"><i class="fa-solid fa-edit"></i></button>
                        <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; background-color: var(--danger);" onclick="deleteInventory(${Number(item.id)})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    db.collection("lampi_data").doc("inventory_system").onSnapshot(
        (doc) => {
            if (doc.exists) {
                const data = doc.data() || {};
                renderInventory(data.inventory || []);
            } else {
                renderInventory([]);
            }
        },
        reportDataError
    );

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            saveForm().catch(reportDataError);
        });
        async function saveForm() {
            const tombo = document.getElementById('item-tombo').value;
            const name = document.getElementById('item-name').value;
            const status = document.getElementById('item-status').value;
            const user = document.getElementById('item-user').value || '-';
            
            const docData = (await dbAPI.getDoc("lampi_data", "inventory_system")) || {};
            let inventory = docData.inventory || [];

            if (editingInventoryId) {
                inventory = inventory.map(item => item.id === editingInventoryId ? { id: item.id, tombo, name, status, user } : item);
                editingInventoryId = null;
                if (submitBtn) {
                    submitBtn.innerHTML = "Registrar";
                    submitBtn.className = "btn btn-green";
                }
            } else {
                inventory.push({ id: Date.now(), tombo, name, status, user });
            }

            await dbAPI.setDoc("lampi_data", "inventory_system", { inventory: inventory });
            form.reset();
        }
    }

    window.deleteInventory = id => deleteInventory(id).catch(reportDataError);
    async function deleteInventory(id) {
        if (confirm("Remover este equipamento do inventário?")) {
            const docData = (await dbAPI.getDoc("lampi_data", "inventory_system")) || {};
            let inventory = (docData.inventory || []).filter(item => item.id !== id);
            await dbAPI.setDoc("lampi_data", "inventory_system", { inventory: inventory });
        }
    }

    window.prepareEditInventory = id => prepareEditInventory(id).catch(reportDataError);
    async function prepareEditInventory(id) {
        const docData = (await dbAPI.getDoc("lampi_data", "inventory_system")) || {};
        const item = (docData.inventory || []).find(i => i.id === id);
        if (item) {
            document.getElementById('item-tombo').value = item.tombo;
            document.getElementById('item-name').value = item.name;
            document.getElementById('item-status').value = item.status;
            document.getElementById('item-user').value = item.user === '-' ? '' : item.user;
            editingInventoryId = id;
            if (submitBtn) {
                submitBtn.innerHTML = "Atualizar";
                submitBtn.className = "btn";
            }
        }
    }
}
}).catch(reportDataError);
