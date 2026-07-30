// ==========================================
// LAMPI WEB APP - CHAMADA, PROJETOS E INVENTÁRIO
// ==========================================

// --- GERENCIAMENTO DE MEMBROS E CHAMADA ---
if (document.getElementById('chamada-page')) {
    const datePicker = document.getElementById('date-picker');
    const shiftPicker = document.getElementById('shift-picker');
    const membersList = document.getElementById('members-list');
    const manageMembersList = document.getElementById('manage-members-list');
    const statusMsg = document.getElementById('save-status');

    // Garante o preenchimento imediato da data de hoje
    const today = new Date().toISOString().split('T')[0];
    if (datePicker && !datePicker.value) {
        datePicker.value = today;
    }

    let currentFirebaseData = {
        members: [],
        attendance: {},
        member_details: {}
    };

    function calculateTotalHours(memberName, attendanceObj) {
        let totalShifts = 0;
        Object.keys(attendanceObj || {}).forEach(recordKey => {
            if (attendanceObj[recordKey] && attendanceObj[recordKey][memberName] === true) {
                totalShifts++;
            }
        });
        return totalShifts * 4;
    }

    function renderAttendancePage() {
        if (!datePicker || !shiftPicker) return;
        const date = datePicker.value || today;
        const shift = shiftPicker.value || "manha";
        const recordKey = `${date}_${shift}`;

        const members = (currentFirebaseData.members || []).slice().sort();
        const attendanceData = currentFirebaseData.attendance || {};
        const currentRecord = attendanceData[recordKey] || {};

        if (membersList) {
            membersList.innerHTML = '';
            if (members.length === 0) {
                membersList.innerHTML = `<li style="padding: 1rem; color: var(--text-muted);">Nenhum membro cadastrado ainda. Adicione ao lado!</li>`;
            }

            if (attendanceData[recordKey]) {
                statusMsg.innerHTML = `<span class="status-badge status-presente"><i class="fa-solid fa-check"></i> Salva no Firebase</span>`;
            } else {
                statusMsg.innerHTML = `<span class="status-badge status-ausente">Pendente</span>`;
            }

            members.forEach((member) => {
                const isPresent = currentRecord[member] === true;
                const li = document.createElement('li');
                li.className = 'member-row';
                li.innerHTML = `
                    <div class="clickable-name" onclick="openMemberModal('${member}')" style="font-weight: 600; cursor: pointer;" title="Ver detalhes e horas no laboratório">${member}</div>
                    <div>
                        <label class="switch">
                            <input type="checkbox" class="attendance-checkbox" data-member="${member}" ${isPresent ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>
                `;
                membersList.appendChild(li);
            });
        }

        if (manageMembersList) {
            manageMembersList.innerHTML = '';
            if (members.length === 0) {
                manageMembersList.innerHTML = `<li style="padding: 0.5rem; color: var(--text-muted); font-size: 0.85rem;">Lista vazia</li>`;
            }
            members.forEach((member) => {
                const totalHours = calculateTotalHours(member, attendanceData);
                const li = document.createElement('li');
                li.className = 'member-row';
                li.style.padding = '0.5rem 1rem';
                li.innerHTML = `
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-size: 0.9rem; font-weight: 600;">${member}</span>
                        <span style="font-size: 0.75rem; color: var(--accent-green); font-weight: 800;"><i class="fa-solid fa-clock"></i> ${totalHours}h no LAMPI</span>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button class="btn btn-green" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="editMember('${member}')"><i class="fa-solid fa-edit"></i></button>
                        <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; background-color: var(--danger);" onclick="deleteMember('${member}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
                manageMembersList.appendChild(li);
            });
        }
    }

    // Renderiza a interface imediatamente ao carregar a página
    renderAttendancePage();

    // Escuta alterações no Firebase em tempo real
    db.collection("lampi_data").doc("attendance_system").onSnapshot(
        async (doc) => {
            if (doc.exists) {
                currentFirebaseData = doc.data() || { members: [], attendance: {}, member_details: {} };
                renderAttendancePage();
            } else {
                // Se o documento não existir no banco, cria uma estrutura vazia automaticamente
                await dbAPI.setDoc("lampi_data", "attendance_system", { 
                    members: [], 
                    attendance: {}, 
                    member_details: {} 
                });
            }
        },
        (error) => {
            console.error("Erro no Firebase onSnapshot (Chamada):", error);
        }
    );

    // ADICIONAR NOVO MEMBRO (Gravação Direta no Banco)
    const formAddMember = document.getElementById('form-add-member');
    if (formAddMember) {
        formAddMember.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('new-member-name');
            const newName = input.value.trim();

            if (newName) {
                const docData = (await dbAPI.getDoc("lampi_data", "attendance_system")) || {};
                const members = docData.members || [];
                const details = docData.member_details || {};

                if (!members.includes(newName)) {
                    members.push(newName);
                    details[newName] = { joinDate: new Date().toISOString().split('T')[0] };
                    
                    const sucesso = await dbAPI.setDoc("lampi_data", "attendance_system", { 
                        members: members,
                        member_details: details 
                    });

                    if (sucesso) {
                        input.value = '';
                    } else {
                        alert("Erro ao salvar no Firebase! Verifique sua internet ou permissões.");
                    }
                } else { 
                    alert("Este membro já está cadastrado!"); 
                }
            }
        });
    }

    // BOTÃO: Salvar Chamada do Dia
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        btnSave.addEventListener('click', async () => {
            const date = datePicker.value;
            const shift = shiftPicker.value;
            const recordKey = `${date}_${shift}`;
            
            const currentRecord = {};
            document.querySelectorAll('.attendance-checkbox').forEach(cb => {
                currentRecord[cb.getAttribute('data-member')] = cb.checked;
            });

            const docData = (await dbAPI.getDoc("lampi_data", "attendance_system")) || {};
            const updatedAttendance = docData.attendance || {};
            updatedAttendance[recordKey] = currentRecord;

            const success = await dbAPI.setDoc("lampi_data", "attendance_system", { 
                attendance: updatedAttendance 
            });

            if (success) {
                alert("Chamada salva com sucesso no Firebase!");
            }
        });
    }

    // MODAL DE HORAS
    window.openMemberModal = function(memberName) {
        const attendance = currentFirebaseData.attendance || {};
        const details = currentFirebaseData.member_details || {};
        
        let firstSeenDate = null;
        Object.keys(attendance).sort().forEach(recordKey => {
            if (attendance[recordKey] && attendance[recordKey][memberName] === true) {
                const datePart = recordKey.split('_')[0];
                if (!firstSeenDate) firstSeenDate = datePart;
            }
        });

        const totalHours = calculateTotalHours(memberName, attendance);
        let joinDate = details[memberName]?.joinDate || firstSeenDate || "Sem registros";

        let formattedDate = joinDate;
        if (joinDate.includes('-')) {
            const [y, m, d] = joinDate.split('-');
            formattedDate = `${d}/${m}/${y}`;
        }

        document.getElementById('modal-member-name').innerText = memberName;
        document.getElementById('modal-join-date').innerText = formattedDate;
        document.getElementById('modal-total-hours').innerText = totalHours;
        document.getElementById('member-modal').style.display = 'flex';
    };

    const closeModal = document.getElementById('close-modal');
    if (closeModal) {
        closeModal.addEventListener('click', () => {
            document.getElementById('member-modal').style.display = 'none';
        });
    }

    const memberModal = document.getElementById('member-modal');
    if (memberModal) {
        memberModal.addEventListener('click', (e) => {
            if (e.target === memberModal) {
                memberModal.style.display = 'none';
            }
        });
    }

    window.deleteMember = async function(name) {
        if (confirm(`Remover ${name} do laboratório?`)) {
            const docData = (await dbAPI.getDoc("lampi_data", "attendance_system")) || {};
            const members = (docData.members || []).filter(m => m !== name);
            await dbAPI.setDoc("lampi_data", "attendance_system", { members: members });
        }
    };

    window.editMember = async function(oldName) {
        const newName = prompt(`Editar nome de: ${oldName}`, oldName);
        if (newName && newName.trim() !== "" && newName.trim() !== oldName) {
            const formattedNewName = newName.trim();
            const docData = (await dbAPI.getDoc("lampi_data", "attendance_system")) || {};
            let members = docData.members || [];
            let details = docData.member_details || {};
            let attendance = docData.attendance || {};

            const idx = members.indexOf(oldName);
            if (idx !== -1) {
                // 1. Atualiza o nome na lista principal
                members[idx] = formattedNewName;

                // 2. Transfere a data de entrada (joinDate) para o novo nome
                if (details[oldName]) {
                    details[formattedNewName] = details[oldName];
                    delete details[oldName];
                }

                // 3. Transfere TODAS as presenças antigas do nome velho para o novo nome
                Object.keys(attendance).forEach(recordKey => {
                    if (attendance[recordKey] && attendance[recordKey][oldName] !== undefined) {
                        attendance[recordKey][formattedNewName] = attendance[recordKey][oldName];
                        delete attendance[recordKey][oldName];
                    }
                });

                // 4. Salva tudo atualizado no Firebase
                const sucesso = await dbAPI.setDoc("lampi_data", "attendance_system", { 
                    members: members,
                    member_details: details,
                    attendance: attendance
                });

                if (sucesso) {
                    alert(`Nome alterado com sucesso! Todo o histórico de horas de "${oldName}" foi mantido para "${formattedNewName}".`);
                } else {
                    alert("Erro ao atualizar o histórico no Firebase.");
                }
            }
        }
    };

    if (datePicker) datePicker.addEventListener('change', renderAttendancePage);
    if (shiftPicker) shiftPicker.addEventListener('change', renderAttendancePage);
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

    db.collection("lampi_data").doc("projects_system").onSnapshot(
        async (doc) => {
            if (doc.exists) {
                const data = doc.data() || {};
                renderProjects(data.projects || []);
            } else {
                await dbAPI.setDoc("lampi_data", "projects_system", { projects: [] });
            }
        },
        (error) => console.error("Erro no Firebase onSnapshot (Projetos):", error)
    );

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
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
        });
    }

    window.deleteProject = async function(id) {
        if (confirm("Excluir este projeto permanentemente?")) {
            const docData = (await dbAPI.getDoc("lampi_data", "projects_system")) || {};
            let projects = (docData.projects || []).filter(p => p.id !== id);
            await dbAPI.setDoc("lampi_data", "projects_system", { projects: projects });
        }
    };

    window.prepareEditProject = async function(id) {
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
    };
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

    db.collection("lampi_data").doc("inventory_system").onSnapshot(
        async (doc) => {
            if (doc.exists) {
                const data = doc.data() || {};
                renderInventory(data.inventory || []);
            } else {
                await dbAPI.setDoc("lampi_data", "inventory_system", { inventory: [] });
            }
        },
        (error) => console.error("Erro no Firebase onSnapshot (Inventário):", error)
    );

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
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
        });
    }

    window.deleteInventory = async function(id) {
        if (confirm("Remover este equipamento do inventário?")) {
            const docData = (await dbAPI.getDoc("lampi_data", "inventory_system")) || {};
            let inventory = (docData.inventory || []).filter(item => item.id !== id);
            await dbAPI.setDoc("lampi_data", "inventory_system", { inventory: inventory });
        }
    };

    window.prepareEditInventory = async function(id) {
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
    };
}