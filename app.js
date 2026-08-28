/* =========================================================
   Lançamento de OS — lógica do aplicativo
   Persistência local (localStorage) até o banco de dados
   definitivo ser conectado.
   ========================================================= */

const STORAGE_KEY = 'os_semanal_state_v1';
const ADMIN_PIN = '1234'; // PIN provisório — trocar quando o admin for cadastrado no banco

const WEEKDAY_NAMES = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

/* ---------------- Estado ---------------- */

function defaultState(){
  return {
    sectorName: 'CABEÇOTES',
    clients: [
      { id: uid(), name: 'João Mecânica', color: '#d98a3d' },
      { id: uid(), name: 'Oficina Silva', color: '#4fa8a0' }
    ],
    services: []
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if(!parsed.clients || !parsed.services) return defaultState();
    return parsed;
  }catch(e){
    console.error('Falha ao carregar estado, usando padrão.', e);
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

/* View state (não persistido) */
let viewYear, viewMonth; // mês sendo exibido
let activeWeekIndex = 0;
let currentWeeks = [];
let editingServiceId = null; // OS aberta no modal de detalhe
let pendingNewOSDate = null; // data selecionada para criar nova OS
let pendingAdminAction = null; // callback após PIN correto

/* ---------------- Utilidades ---------------- */

function uid(){
  return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
}

function todayISO(){
  return formatISO(new Date());
}

function formatISO(date){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function parseISO(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y, m-1, d);
}

function formatDisplayDate(iso){
  const d = parseISO(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

function showToast(msg){
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toast.classList.add('hidden'), 2200);
}

/* ---------------- Cálculo das semanas do mês ---------------- */

// Retorna as semanas (segunda a domingo) que possuem ao menos um dia dentro do mês/ano informado.
// Cada semana contém apenas os dias que pertencem ao mês (para não exibir dias de outro mês).
function getMonthWeeks(year, month){
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month+1, 0);

  // Encontra a segunda-feira da semana que contém o primeiro dia do mês
  let cursor = new Date(firstDay);
  const dow = (cursor.getDay() + 6) % 7; // 0 = segunda
  cursor.setDate(cursor.getDate() - dow);

  const weeks = [];
  while(cursor <= lastDay){
    const weekDays = [];
    for(let i=0;i<7;i++){
      const d = new Date(cursor);
      d.setDate(cursor.getDate()+i);
      if(d.getMonth() === month && d.getFullYear() === year){
        weekDays.push(formatISO(d));
      }
    }
    if(weekDays.length){
      weeks.push({ days: weekDays });
    }
    cursor.setDate(cursor.getDate()+7);
  }

  weeks.forEach((w,i)=> w.label = `Semana ${i+1}`);
  return weeks;
}

function weekIndexContainingDate(weeks, iso){
  return weeks.findIndex(w => w.days.includes(iso));
}

/* ---------------- Clientes ---------------- */

function getClient(id){
  return state.clients.find(c => c.id === id);
}

function addClient(name, color){
  const client = { id: uid(), name: name.trim(), color };
  state.clients.push(client);
  saveState();
  return client;
}

function updateClient(id, fields){
  const c = getClient(id);
  if(!c) return;
  Object.assign(c, fields);
  saveState();
}

function deleteClient(id){
  const inUse = state.services.some(s => s.clientId === id);
  if(inUse){
    if(!confirm('Este cliente possui OS lançadas. Remover mesmo assim? As OS ficarão sem cliente vinculado.')) return;
  }
  state.clients = state.clients.filter(c => c.id !== id);
  saveState();
  renderClientsList();
  populateClientSelects();
  renderWeekContent();
}

/* ---------------- Serviços (OS) ---------------- */

function createService(clientId, dateIso, description){
  const service = {
    id: uid(),
    clientId,
    date: dateIso,
    description: description.trim(),
    images: [],
    status: 'pending',
    createdAt: Date.now()
  };
  state.services.push(service);
  saveState();
  return service;
}

function getService(id){
  return state.services.find(s => s.id === id);
}

function deleteService(id){
  state.services = state.services.filter(s => s.id !== id);
  saveState();
}

function setServiceStatus(id, status){
  const s = getService(id);
  if(!s) return;
  s.status = (s.status === status) ? 'pending' : status;
  saveState();
  renderWeekContent();
}

function servicesForDate(iso){
  return state.services
    .filter(s => s.date === iso)
    .sort((a,b)=> a.createdAt - b.createdAt);
}

/* ---------------- Renderização: Topbar / Meses ---------------- */

function renderSectorName(){
  document.getElementById('sectorName').textContent = state.sectorName;
}

function renderMonthLabel(){
  document.getElementById('monthLabel').textContent = `${MONTH_NAMES[viewMonth]} · ${viewYear}`;
}

/* ---------------- Renderização: Abas de semana ---------------- */

function renderWeekTabs(){
  currentWeeks = getMonthWeeks(viewYear, viewMonth);
  const nav = document.getElementById('weekTabs');
  nav.innerHTML = '';

  currentWeeks.forEach((week, idx) => {
    const btn = document.createElement('button');
    btn.className = 'week-tab' + (idx === activeWeekIndex ? ' active' : '');
    const count = week.days.reduce((acc,d)=> acc + servicesForDate(d).length, 0);
    const first = formatDisplayDate(week.days[0]);
    const last = formatDisplayDate(week.days[week.days.length-1]);
    btn.innerHTML = `${week.label} <span class="tab-count">${first}–${last} · ${count}</span>`;
    btn.addEventListener('click', () => {
      activeWeekIndex = idx;
      renderWeekTabs();
      renderWeekContent();
    });
    nav.appendChild(btn);
  });

  if(!currentWeeks[activeWeekIndex] && currentWeeks.length){
    activeWeekIndex = 0;
  }
}

/* ---------------- Renderização: Conteúdo da semana ---------------- */

function renderWeekContent(){
  const container = document.getElementById('weekContent');
  container.innerHTML = '';

  const week = currentWeeks[activeWeekIndex];
  if(!week){
    container.innerHTML = '<p class="empty-day">Nenhuma semana encontrada.</p>';
    return;
  }

  const today = todayISO();

  week.days.forEach(dateIso => {
    const section = document.createElement('div');
    section.className = 'day-section';

    const date = parseISO(dateIso);
    const isToday = dateIso === today;

    const header = document.createElement('div');
    header.className = 'day-header';
    header.innerHTML = `
      <div class="day-title">
        <h3>${WEEKDAY_NAMES[date.getDay()]}</h3>
        <span class="day-date">${formatDisplayDate(dateIso)}</span>
        ${isToday ? '<span class="today-badge">Hoje</span>' : ''}
      </div>
    `;

    const addBtn = document.createElement('button');
    addBtn.className = 'day-add-btn';
    addBtn.textContent = '+ Criar OS';
    addBtn.addEventListener('click', () => openNewOSModal(dateIso));
    header.appendChild(addBtn);

    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'services-list';
    const services = servicesForDate(dateIso);

    if(!services.length){
      const empty = document.createElement('p');
      empty.className = 'empty-day';
      empty.textContent = 'Nenhuma OS lançada para este dia.';
      list.appendChild(empty);
    } else {
      services.forEach(svc => list.appendChild(buildServiceCard(svc)));
    }

    section.appendChild(list);
    container.appendChild(section);
  });
}

function buildServiceCard(svc){
  const client = getClient(svc.clientId);
  const color = client ? client.color : '#888888';
  const name = client ? client.name : 'Cliente removido';

  const card = document.createElement('div');
  card.className = `service-card status-${svc.status}`;
  card.style.setProperty('--client-color', color);

  card.innerHTML = `
    <div class="service-main">
      <span class="client-name" style="color:${color}">${escapeHtml(name)}</span>
      <span class="service-desc">${escapeHtml(svc.description || 'Sem descrição')}</span>
      <div class="service-meta">${svc.images.length ? '📎 ' + svc.images.length + ' imagem(ns)' : ''}</div>
    </div>
    <div class="service-actions">
      <button class="action-btn done-btn ${svc.status==='done'?'active':''}" title="Marcar como concluído">✓</button>
      <button class="action-btn postpone-btn ${svc.status==='postponed'?'active':''}" title="Marcar como adiado">✕</button>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if(e.target.closest('.service-actions')) return;
    openServiceModal(svc.id);
  });

  card.querySelector('.done-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    setServiceStatus(svc.id, 'done');
  });
  card.querySelector('.postpone-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    setServiceStatus(svc.id, 'postponed');
  });

  return card;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- Modal: Detalhe / edição de OS ---------------- */

function populateClientSelects(){
  ['svcClientSelect','newOSClientSelect'].forEach(id => {
    const select = document.getElementById(id);
    const current = select.value;
    select.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if(current) select.value = current;
  });
}

function openServiceModal(serviceId){
  editingServiceId = serviceId;
  const svc = getService(serviceId);
  if(!svc) return;

  populateClientSelects();
  document.getElementById('svcClientSelect').value = svc.clientId;
  const client = getClient(svc.clientId);
  document.getElementById('svcClientColor').value = client ? client.color : '#d98a3d';
  document.getElementById('svcDate').value = svc.date;
  document.getElementById('svcDescription').value = svc.description;

  setStatusButtonsUI(svc.status);
  renderServiceImages(svc.images);

  document.getElementById('serviceModal').classList.remove('hidden');
}

function setStatusButtonsUI(status){
  ['svcStatusDone','svcStatusPending','svcStatusPostponed'].forEach(id => {
    const btn = document.getElementById(id);
    btn.classList.toggle('selected', btn.dataset.status === status);
  });
}

function renderServiceImages(images){
  const grid = document.getElementById('svcImagesGrid');
  grid.innerHTML = '';
  if(!images.length){
    grid.innerHTML = '<p class="images-empty">Nenhuma imagem adicionada.</p>';
    return;
  }
  images.forEach((src, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'image-thumb';
    thumb.innerHTML = `<img src="${src}" alt="Peça"/><button class="remove-image" title="Excluir imagem">&times;</button>`;
    thumb.querySelector('.remove-image').addEventListener('click', () => {
      const svc = getService(editingServiceId);
      svc.images.splice(idx,1);
      saveState();
      renderServiceImages(svc.images);
      renderWeekContent();
    });
    grid.appendChild(thumb);
  });
}

function closeServiceModal(){
  document.getElementById('serviceModal').classList.add('hidden');
  editingServiceId = null;
}

function saveServiceModal(){
  const svc = getService(editingServiceId);
  if(!svc) return;

  svc.clientId = document.getElementById('svcClientSelect').value;
  svc.date = document.getElementById('svcDate').value;
  svc.description = document.getElementById('svcDescription').value;

  const selectedStatusBtn = document.querySelector('#serviceModal .status-btn.selected');
  svc.status = selectedStatusBtn ? selectedStatusBtn.dataset.status : svc.status;

  const newColor = document.getElementById('svcClientColor').value;
  const client = getClient(svc.clientId);
  if(client) client.color = newColor;

  saveState();
  closeServiceModal();
  syncWeekToDate(svc.date);
  showToast('OS salva.');
}

function syncWeekToDate(dateIso){
  currentWeeks = getMonthWeeks(viewYear, viewMonth);
  const idx = weekIndexContainingDate(currentWeeks, dateIso);
  if(idx >= 0) activeWeekIndex = idx;
  renderWeekTabs();
  renderWeekContent();
}

/* ---------------- Modal: Nova OS ---------------- */

function openNewOSModal(dateIso){
  pendingNewOSDate = dateIso;
  populateClientSelects();
  document.getElementById('newOSDescription').value = '';
  const d = parseISO(dateIso);
  document.getElementById('newOSDateLabel').textContent =
    `${WEEKDAY_NAMES[d.getDay()]}, ${formatDisplayDate(dateIso)}`;
  document.getElementById('newOSModal').classList.remove('hidden');
}

function closeNewOSModal(){
  document.getElementById('newOSModal').classList.add('hidden');
  pendingNewOSDate = null;
}

function confirmCreateOS(){
  if(!state.clients.length){
    showToast('Cadastre um cliente antes de criar uma OS.');
    return;
  }
  const clientId = document.getElementById('newOSClientSelect').value;
  const description = document.getElementById('newOSDescription').value;
  createService(clientId, pendingNewOSDate, description);
  closeNewOSModal();
  syncWeekToDate(pendingNewOSDate);
  showToast('OS criada.');
}

/* ---------------- Modal: Clientes ---------------- */

function openClientsModal(){
  renderClientsList();
  document.getElementById('clientsModal').classList.remove('hidden');
}

function closeClientsModal(){
  document.getElementById('clientsModal').classList.add('hidden');
}

function renderClientsList(){
  const list = document.getElementById('clientsList');
  list.innerHTML = '';
  if(!state.clients.length){
    list.innerHTML = '<p class="images-empty">Nenhum cliente cadastrado.</p>';
    return;
  }
  state.clients.forEach(client => {
    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <span class="client-swatch" style="background:${client.color}"></span>
      <input type="text" value="${escapeHtml(client.name)}" />
      <input type="color" class="color-input" value="${client.color}" style="width:34px;height:30px;" />
      <button class="delete-client" title="Excluir cliente">🗑</button>
    `;
    const nameInput = row.querySelector('input[type="text"]');
    const colorInput = row.querySelector('input[type="color"]');
    nameInput.addEventListener('change', () => updateClient(client.id, { name: nameInput.value }));
    colorInput.addEventListener('input', () => {
      row.querySelector('.client-swatch').style.background = colorInput.value;
      updateClient(client.id, { color: colorInput.value });
      renderWeekContent();
    });
    row.querySelector('.delete-client').addEventListener('click', () => deleteClient(client.id));
    list.appendChild(row);
  });
}

/* ---------------- Modal: PIN admin ---------------- */

function requestAdminAccess(action){
  pendingAdminAction = action;
  document.getElementById('pinInput').value = '';
  document.getElementById('pinError').classList.add('hidden');
  document.getElementById('pinModal').classList.remove('hidden');
  setTimeout(()=> document.getElementById('pinInput').focus(), 50);
}

function closePinModal(){
  document.getElementById('pinModal').classList.add('hidden');
  pendingAdminAction = null;
}

function confirmPin(){
  const value = document.getElementById('pinInput').value;
  if(value === ADMIN_PIN){
    const action = pendingAdminAction;
    closePinModal();
    if(action) action();
  } else {
    document.getElementById('pinError').classList.remove('hidden');
  }
}

/* ---------------- Edição do nome do setor ---------------- */

function enableSectorNameEditing(){
  const el = document.getElementById('sectorName');
  el.setAttribute('contenteditable', 'true');
  el.focus();
  document.execCommand('selectAll', false, null);

  function finish(){
    el.removeAttribute('contenteditable');
    const newName = el.textContent.trim().toUpperCase() || state.sectorName;
    el.textContent = newName;
    state.sectorName = newName;
    saveState();
    el.removeEventListener('blur', finish);
    el.removeEventListener('keydown', onKey);
  }
  function onKey(e){
    if(e.key === 'Enter'){ e.preventDefault(); el.blur(); }
    if(e.key === 'Escape'){ el.textContent = state.sectorName; el.blur(); }
  }
  el.addEventListener('blur', finish);
  el.addEventListener('keydown', onKey);
}

/* ---------------- Upload de imagens ---------------- */

function handleImageFiles(fileList){
  const svc = getService(editingServiceId);
  if(!svc) return;
  const files = Array.from(fileList);
  let remaining = files.length;
  if(!remaining) return;

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      svc.images.push(e.target.result);
      remaining--;
      if(remaining === 0){
        saveState();
        renderServiceImages(svc.images);
        renderWeekContent();
      }
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- Navegação de mês ---------------- */

function goToMonth(year, month){
  viewYear = year;
  viewMonth = month;
  currentWeeks = getMonthWeeks(viewYear, viewMonth);
  const today = todayISO();
  const idx = weekIndexContainingDate(currentWeeks, today);
  activeWeekIndex = idx >= 0 ? idx : 0;
  renderMonthLabel();
  renderWeekTabs();
  renderWeekContent();
}

function shiftMonth(delta){
  let m = viewMonth + delta;
  let y = viewYear;
  if(m < 0){ m = 11; y -= 1; }
  if(m > 11){ m = 0; y += 1; }
  viewYear = y;
  viewMonth = m;
  currentWeeks = getMonthWeeks(viewYear, viewMonth);
  activeWeekIndex = 0;
  renderMonthLabel();
  renderWeekTabs();
  renderWeekContent();
}

/* ---------------- Inicialização / listeners ---------------- */

function initEventListeners(){
  document.getElementById('sectorName').addEventListener('click', () => {
    requestAdminAccess(enableSectorNameEditing);
  });

  document.getElementById('prevMonthBtn').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', () => shiftMonth(1));

  document.getElementById('manageClientsBtn').addEventListener('click', openClientsModal);

  document.getElementById('fabNewOS').addEventListener('click', () => {
    const today = todayISO();
    const weeks = getMonthWeeks(viewYear, viewMonth);
    const idx = weekIndexContainingDate(weeks, today);
    if(idx < 0){
      showToast('Navegue até o mês atual para lançar a OS de hoje.');
      return;
    }
    activeWeekIndex = idx;
    renderWeekTabs();
    renderWeekContent();
    openNewOSModal(today);
  });

  // Fechar modais
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const overlay = e.target.closest('.modal-overlay');
      overlay.classList.add('hidden');
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if(e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // Modal de serviço
  document.getElementById('svcSaveBtn').addEventListener('click', saveServiceModal);
  document.getElementById('svcDeleteBtn').addEventListener('click', () => {
    if(!editingServiceId) return;
    if(confirm('Excluir esta OS definitivamente?')){
      const svc = getService(editingServiceId);
      const dateIso = svc.date;
      deleteService(editingServiceId);
      closeServiceModal();
      syncWeekToDate(dateIso);
      showToast('OS excluída.');
    }
  });
  ['svcStatusDone','svcStatusPending','svcStatusPostponed'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      setStatusButtonsUI(document.getElementById(id).dataset.status);
    });
  });
  document.getElementById('svcImageInput').addEventListener('change', (e) => {
    handleImageFiles(e.target.files);
    e.target.value = '';
  });

  // Modal de nova OS
  document.getElementById('newOSCreateBtn').addEventListener('click', confirmCreateOS);
  document.getElementById('newOSAddClientBtn').addEventListener('click', () => {
    closeNewOSModal();
    openClientsModal();
  });

  // Modal de clientes
  document.getElementById('addClientBtn').addEventListener('click', () => {
    const nameInput = document.getElementById('newClientName');
    const colorInput = document.getElementById('newClientColor');
    if(!nameInput.value.trim()){
      showToast('Informe o nome do cliente.');
      return;
    }
    addClient(nameInput.value, colorInput.value);
    nameInput.value = '';
    renderClientsList();
    populateClientSelects();
    renderWeekContent();
  });

  // Modal PIN
  document.getElementById('pinConfirmBtn').addEventListener('click', confirmPin);
  document.getElementById('pinInput').addEventListener('keydown', (e) => {
    if(e.key === 'Enter') confirmPin();
  });
}

function init(){
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();

  renderSectorName();
  populateClientSelects();
  initEventListeners();
  goToMonth(viewYear, viewMonth);
}

document.addEventListener('DOMContentLoaded', init);
