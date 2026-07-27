// --- SISTEMA DE LOGIN ---
// Defina aqui os usuários e senhas de quem pode acessar o sistema
const allowedUsers = {
    "Richard": "pimenta06",
    "Murilo": "143.266.070-28" // Substitua pelo nome e senha reais
};

// Descobre em qual página o usuário está no momento
const currentPage = window.location.pathname.split("/").pop() || "index.html";

// Se não estiver logado e tentar acessar qualquer página que não seja o login, é redirecionado
const isLoggedIn = sessionStorage.getItem("lampi_logged_in");

if (!isLoggedIn && currentPage !== "login.html") {
    window.location.href = "login.html";
}

// Lógica exclusiva da página de Login
if (document.getElementById('login-page')) {
    document.getElementById('form-login').addEventListener('submit', (e) => {
        e.preventDefault();
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value.trim();

        if (allowedUsers[user] && allowedUsers[user] === pass) {
            // Salva o login na sessão (apaga quando fechar o navegador)
            sessionStorage.setItem("lampi_logged_in", user);
            window.location.href = "index.html";
        } else {
            alert("Usuário ou senha incorretos!");
        }
    });
}

// Função de Sair (Logout)
function logout() {
    sessionStorage.removeItem("lampi_logged_in");
    window.location.href = "login.html";
}
// ------------------------
// --- CONTROLE DE ARQUIVOS FÍSICOS (JSON SEPARADOS) ---
// Guardamos a referência de cada arquivo separadamente
const fileHandles = {
    chamada: null,
    projetos: null,
    inventario: null
};

// Configuração de quais dados vão para qual arquivo
const fileConfigs = {
    chamada: {
        name: 'lampi_chamadas.json',
        keys: ['lampi_members', 'lampi_attendance', 'lampi_member_details'] // Chamada precisa dos membros e da frequência
    },
    projetos: {
        name: 'lampi_projetos.json',
        keys: ['lampi_projects']
    },
    inventario: {
        name: 'lampi_inventario.json',
        keys: ['lampi_inventory']
    }
};

async function syncToFile(type) {
    try {
        const config = fileConfigs[type];
        const dataToSave = {};
        
        // Puxa do localStorage apenas as chaves correspondentes a esta página
        config.keys.forEach(key => {
            dataToSave[key] = getData(key);
        });

        // Se ainda não selecionou o arquivo para este tipo, abre a janela
        if (!fileHandles[type]) {
            fileHandles[type] = await window.showSaveFilePicker({
                suggestedName: config.name,
                types: [{
                    description: `Arquivo JSON de ${type}`,
                    accept: { 'application/json': ['.json'] },
                }],
            });
        }

        // Escreve no arquivo
        const writable = await fileHandles[type].createWritable();
        await writable.write(JSON.stringify(dataToSave, null, 2));
        await writable.close();

        alert(`Arquivo de ${type} sincronizado com sucesso no seu computador!`);
    } catch (error) {
        console.error(`Erro ao salvar arquivo de ${type}:`, error);
    }
}

async function loadFromFile(type) {
    try {
        const config = fileConfigs[type];
        
        // Abre a janela para ler o arquivo
        const [fileHandleRead] = await window.showOpenFilePicker({
            types: [{
                description: `Arquivo JSON de ${type}`,
                accept: { 'application/json': ['.json'] },
            }],
        });
        
        fileHandles[type] = fileHandleRead; 
        const file = await fileHandles[type].getFile();
        const contents = await file.text();
        const importedData = JSON.parse(contents);

        // Devolve os dados para o LocalStorage
        config.keys.forEach(key => {
            if (importedData[key]) {
                setData(key, importedData[key]);
            }
        });

        alert(`Dados de ${type} carregados com sucesso! A página será atualizada.`);
        window.location.reload(); 
    } catch (error) {
        console.error(`Erro ao carregar arquivo de ${type}:`, error);
    }
}

// ... [O RESTANTE DO SEU SCRIPT CONTINUA EXATAMENTE AQUI PARA BAIXO (defaultData, initDB, etc)] ...

// --- GERENCIAMENTO DE DADOS (LocalStorage) ---
const defaultData = {
    members: ["Antonio Willian", "Francisco Gabriel", "Gabriel Fernandes", "Jailson", "João Francisco", "Karol", "Larissa Lacerda", "Murilo", "Richard", "Fernando"],
    projects: [
        { id: 1, title: "Sistema de Reserva Inteligente", tech: "Web", desc: "Sistema para gerenciar reservas de assentos." },
        { id: 2, title: "Reconhecimento de Gestos", tech: "OpenCV", desc: "Rastreamento de marcos das mãos." }
    ],
    inventory: [
        { id: 1710000000001, tombo: "123456", name: "Notebook Dell Inspiron", status: "Disponível", user: "-" },
        { id: 1710000000002, tombo: "789012", name: "Sensor LiDAR Arduino", status: "Em uso", user: "Richard" }
    ],
    attendance: {}
};

function initDB() {
    if (!localStorage.getItem('lampi_members')) localStorage.setItem('lampi_members', JSON.stringify(defaultData.members));
    if (!localStorage.getItem('lampi_projects')) localStorage.setItem('lampi_projects', JSON.stringify(defaultData.projects));
    if (!localStorage.getItem('lampi_inventory')) localStorage.setItem('lampi_inventory', JSON.stringify(defaultData.inventory));
    if (!localStorage.getItem('lampi_attendance')) localStorage.setItem('lampi_attendance', JSON.stringify(defaultData.attendance));
    if (!localStorage.getItem('lampi_member_details')) localStorage.setItem('lampi_member_details', JSON.stringify({}));
}

function getData(key) { return JSON.parse(localStorage.getItem(key)); }
function setData(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

initDB();

// --- VARIÁVEIS DE CONTROLE DE EDIÇÃO ---
let editingProjectId = null;
let editingInventoryId = null;

// --- GERENCIAMENTO DE MEMBROS E CHAMADA ---
if (document.getElementById('chamada-page')) {
    const datePicker = document.getElementById('date-picker');
    const shiftPicker = document.getElementById('shift-picker');
    const membersList = document.getElementById('members-list');
    const manageMembersList = document.getElementById('manage-members-list');
    const statusMsg = document.getElementById('save-status');

    const today = new Date().toISOString().split('T')[0];
    if(!datePicker.value) datePicker.value = today;

    function loadAttendancePage() {
        const date = datePicker.value;
        const shift = shiftPicker.value;
        const recordKey = `${date}_${shift}`;
        
        const members = getData('lampi_members').sort();
        const attendanceData = getData('lampi_attendance');
        const currentRecord = attendanceData[recordKey] || {};

        membersList.innerHTML = '';
        if(attendanceData[recordKey]) {
            statusMsg.innerHTML = `<span class="status-badge status-presente"><i class="fa-solid fa-check"></i> Salva</span>`;
        } else {
            statusMsg.innerHTML = `<span class="status-badge status-ausente">Pendente</span>`;
        }

        members.forEach((member) => {
            const isPresent = currentRecord[member] === true;
            const li = document.createElement('li');
            li.className = 'member-row';
            li.innerHTML = `
                <div class="clickable-name" onclick="openMemberModal('${member}')" style="font-weight: 600;" title="Ver detalhes do membro">${member}</div>
                <div>
                    <label class="switch">
                        <input type="checkbox" class="attendance-checkbox" data-member="${member}" ${isPresent ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            `;
            membersList.appendChild(li);
        });

        if(manageMembersList) {
            manageMembersList.innerHTML = '';
            members.forEach((member) => {
                const li = document.createElement('li');
                li.className = 'member-row';
                li.style.padding = '0.5rem 1rem';
                li.innerHTML = `
                    <span style="font-size: 0.9rem;">${member}</span>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-green" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="editMember('${member}')"><i class="fa-solid fa-edit"></i></button>
                        <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; background-color: var(--danger);" onclick="deleteMember('${member}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
                manageMembersList.appendChild(li);
            });
        }
    }

    document.getElementById('btn-save').addEventListener('click', () => {
        const date = datePicker.value;
        const shift = shiftPicker.value;
        const recordKey = `${date}_${shift}`;
        const attendanceData = getData('lampi_attendance');
        const currentRecord = {};
        
        document.querySelectorAll('.attendance-checkbox').forEach(cb => {
            currentRecord[cb.getAttribute('data-member')] = cb.checked;
        });

        attendanceData[recordKey] = currentRecord;
        setData('lampi_attendance', attendanceData);
        loadAttendancePage();
        alert("Chamada salva no navegador! Não esqueça de 'Sincronizar' na página inicial se quiser guardar no arquivo.");
    });

    // --- LÓGICA DO MODAL DE HORAS ---
    window.openMemberModal = function(memberName) {
        const attendance = getData('lampi_attendance') || {};
        const details = getData('lampi_member_details') || {};
        
        let totalShifts = 0;
        let firstSeenDate = null;
        
        // Vasculha todo o histórico para contar presenças e achar a primeira data
        Object.keys(attendance).sort().forEach(recordKey => {
            if (attendance[recordKey][memberName] === true) {
                totalShifts++;
                const datePart = recordKey.split('_')[0];
                if (!firstSeenDate) firstSeenDate = datePart; 
            }
        });

        // Cada turno = 4 horas
        const totalHours = totalShifts * 4;
        
        // Define a data de entrada (a salva no sistema OU a da 1ª presença)
        let joinDate = details[memberName]?.joinDate;
        if (!joinDate) {
            joinDate = firstSeenDate || "Sem registros";
        }

        // Formata a data de AAAA-MM-DD para DD/MM/AAAA
        let formattedDate = joinDate;
        if (joinDate.includes('-')) {
            const [y, m, d] = joinDate.split('-');
            formattedDate = `${d}/${m}/${y}`;
        }

        // Preenche o modal e exibe
        document.getElementById('modal-member-name').innerText = memberName;
        document.getElementById('modal-join-date').innerText = formattedDate;
        document.getElementById('modal-total-hours').innerText = totalHours;
        document.getElementById('member-modal').style.display = 'flex';
    };

    // Fechar o modal
    document.getElementById('close-modal').addEventListener('click', () => {
        document.getElementById('member-modal').style.display = 'none';
    });

    // Fechar clicando fora da caixinha
    document.getElementById('member-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('member-modal')) {
            document.getElementById('member-modal').style.display = 'none';
        }
    });



    document.getElementById('form-add-member').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('new-member-name');
        const newName = input.value.trim();
        if(newName) {
            const members = getData('lampi_members');
            if(!members.includes(newName)) {
                members.push(newName);
                setData('lampi_members', members);
                
                // --- CÓDIGO NOVO AQUI ---
                // Salva a data de entrada do novo membro como hoje
                const details = getData('lampi_member_details') || {};
                details[newName] = { joinDate: new Date().toISOString().split('T')[0] };
                setData('lampi_member_details', details);
                // -------------------------

                input.value = '';
                loadAttendancePage();
            } else { alert("Membro já existe!"); }
        }
    });

    window.deleteMember = function(name) {
        if(confirm(`Remover ${name} do laboratório?`)) {
            let members = getData('lampi_members');
            members = members.filter(m => m !== name);
            setData('lampi_members', members);
            loadAttendancePage();
        }
    };

    window.editMember = function(oldName) {
        const newName = prompt(`Editar nome de: ${oldName}`, oldName);
        if(newName && newName.trim() !== "") {
            let members = getData('lampi_members');
            const idx = members.indexOf(oldName);
            if(idx !== -1) {
                members[idx] = newName.trim();
                setData('lampi_members', members);
                loadAttendancePage();
            }
        }
    };

    datePicker.addEventListener('change', loadAttendancePage);
    shiftPicker.addEventListener('change', loadAttendancePage);
    loadAttendancePage();
}

// --- GERENCIAMENTO DE PROJETOS ---
if (document.getElementById('projetos-page')) {
    const grid = document.getElementById('projects-grid');
    const form = document.getElementById('form-add-project');
    const submitBtn = form.querySelector('button[type="submit"]');

    function loadProjects() {
        const projects = getData('lampi_projects');
        grid.innerHTML = '';
        projects.forEach(proj => {
            const div = document.createElement('div');
            div.className = 'project-card';
            div.innerHTML = `
                <span class="project-tag">${proj.tech}</span>
                <h3>${proj.title}</h3>
                <p style="margin-top: 0.5rem; color: var(--text-muted); font-size: 0.95rem;">${proj.desc}</p>
                <div style="margin-top: 1.5rem; display: flex; gap: 0.5rem; justify-content: flex-end;">
                    <button class="btn btn-green" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="prepareEditProject(${proj.id})"><i class="fa-solid fa-edit"></i> Editar</button>
                    <button class="btn" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; background-color: var(--danger);" onclick="deleteProject(${proj.id})"><i class="fa-solid fa-trash"></i> Excluir</button>
                </div>
            `;
            grid.appendChild(div);
        });
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = document.getElementById('proj-title').value;
        const tech = document.getElementById('proj-tech').value;
        const desc = document.getElementById('proj-desc').value;
        let projects = getData('lampi_projects');

        if (editingProjectId) {
            projects = projects.map(p => p.id === editingProjectId ? { id: p.id, title, tech, desc } : p);
            editingProjectId = null;
            submitBtn.innerHTML = "Salvar Projeto";
            submitBtn.className = "btn btn-green";
        } else {
            projects.push({ id: Date.now(), title, tech, desc });
        }

        setData('lampi_projects', projects);
        form.reset();
        loadProjects();
    });

    window.deleteProject = function(id) {
        if(confirm("Excluir este projeto permanentemente?")) {
            let projects = getData('lampi_projects');
            projects = projects.filter(p => p.id !== id);
            setData('lampi_projects', projects);
            loadProjects();
        }
    };

    window.prepareEditProject = function(id) {
        const projects = getData('lampi_projects');
        const proj = projects.find(p => p.id === id);
        if(proj) {
            document.getElementById('proj-title').value = proj.title;
            document.getElementById('proj-tech').value = proj.tech;
            document.getElementById('proj-desc').value = proj.desc;
            editingProjectId = id;
            submitBtn.innerHTML = "<i class='fa-solid fa-floppy-disk'></i> Atualizar Alterações";
            submitBtn.className = "btn"; 
            document.querySelector('.card h3').innerHTML = "<i class='fa-solid fa-edit'></i> Editando Projeto";
        }
    };

    loadProjects();
}

// --- GERENCIAMENTO DE INVENTÁRIO (TOMBOS) ---
if (document.getElementById('inventario-page')) {
    const tbody = document.getElementById('inventory-tbody');
    const form = document.getElementById('form-add-item');
    const submitBtn = form.querySelector('button[type="submit"]');

    function loadInventory() {
        const inventory = getData('lampi_inventory');
        tbody.innerHTML = '';
        inventory.forEach(item => {
            const statusClass = item.status === 'Disponível' ? 'status-presente' : 'status-ausente';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${item.tombo}</strong></td>
                <td>${item.name}</td>
                <td><span class="status-badge ${statusClass}">${item.status}</span></td>
                <td>${item.user}</td>
                <td>
                    <div style="display: flex; gap: 0.25rem;">
                        <button class="btn btn-green" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="prepareEditInventory(${item.id})"><i class="fa-solid fa-edit"></i></button>
                        <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; background-color: var(--danger);" onclick="deleteInventory(${item.id})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const tombo = document.getElementById('item-tombo').value;
        const name = document.getElementById('item-name').value;
        const status = document.getElementById('item-status').value;
        const user = document.getElementById('item-user').value || '-';
        let inventory = getData('lampi_inventory');

        if (editingInventoryId) {
            inventory = inventory.map(item => item.id === editingInventoryId ? { id: item.id, tombo, name, status, user } : item);
            editingInventoryId = null;
            submitBtn.innerHTML = "Registrar";
            submitBtn.className = "btn btn-green";
        } else {
            inventory.push({ id: Date.now(), tombo, name, status, user });
        }

        setData('lampi_inventory', inventory);
        form.reset();
        loadInventory();
    });

    window.deleteInventory = function(id) {
        if(confirm("Remover este equipamento do inventário?")) {
            let inventory = getData('lampi_inventory');
            inventory = inventory.filter(item => item.id !== id);
            setData('lampi_inventory', inventory);
            loadInventory();
        }
    };

    window.prepareEditInventory = function(id) {
        const inventory = getData('lampi_inventory');
        const item = inventory.find(i => i.id === id);
        if(item) {
            document.getElementById('item-tombo').value = item.tombo;
            document.getElementById('item-name').value = item.name;
            document.getElementById('item-status').value = item.status;
            document.getElementById('item-user').value = item.user === '-' ? '' : item.user;
            editingInventoryId = id;
            submitBtn.innerHTML = "Atualizar";
            submitBtn.className = "btn";
        }
    };

    loadInventory();
}