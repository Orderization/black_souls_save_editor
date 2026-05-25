const $ = (id) => document.getElementById(id);

let currentArchiveInfo = null;
let currentSave = null;
let activeTab = 'variables';

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function summarizeDb(db) {
  const counts = (obj) => obj ? Object.keys(obj).length : 0;
  return {
    variables: counts(db?.variables),
    switches: counts(db?.switches),
    actors: counts(db?.actors),
    items: counts(db?.items),
    weapons: counts(db?.weapons),
    armors: counts(db?.armors)
  };
}

function currentDb() {
  return currentArchiveInfo?.db || null;
}

function nameFromDb(group, id) {
  const db = currentDb();
  if (!db || !db[group]) return '';
  return db[group][String(id)] || db[group][id] || '';
}

function numericIds(obj) {
  if (!obj) return [];
  return Object.keys(obj)
    .map(x => Number(x))
    .filter(x => Number.isInteger(x) && x > 0);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj ?? null));
}

function byId(rows) {
  const m = new Map();
  (rows || []).forEach(row => {
    const id = Number(row.id);
    if (Number.isInteger(id) && id > 0) m.set(id, row);
  });
  return m;
}

function decorateIndexedRows(saveRows, dbGroup, valueDefaults = {}) {
  const saveMap = byId(saveRows);
  const dbIds = numericIds(currentDb()?.[dbGroup]);
  const ids = [...new Set([...saveMap.keys(), ...dbIds])].sort((a, b) => a - b);
  return ids.map(id => {
    const old = saveMap.get(id) || {};
    return {
      ...valueDefaults,
      ...old,
      id,
      name: nameFromDb(dbGroup, id) || old.name || ''
    };
  });
}

function decorateInventoryRows(saveRows, dbGroup) {
  const saveMap = byId(saveRows);
  const dbIds = numericIds(currentDb()?.[dbGroup]);
  const ids = [...new Set([...saveMap.keys(), ...dbIds])].sort((a, b) => a - b);
  return ids.map(id => {
    const old = saveMap.get(id) || {};
    return {
      id,
      name: nameFromDb(dbGroup, id) || old.name || '',
      count: old.count ?? 0
    };
  });
}

function decorateSave(save) {
  const displayed = clone(save) || {};
  displayed.variables = decorateIndexedRows(save?.variables || [], 'variables', { value: null, type: 'NilClass' });
  displayed.switches = decorateIndexedRows(save?.switches || [], 'switches', { value: false });
  displayed.items = decorateInventoryRows(save?.items || [], 'items');
  displayed.weapons = decorateInventoryRows(save?.weapons || [], 'weapons');
  displayed.armors = decorateInventoryRows(save?.armors || [], 'armors');

  const actorRows = save?.actors || [];
  const actorMap = byId(actorRows);
  const actorIds = [...new Set([...actorMap.keys(), ...numericIds(currentDb()?.actors)])].sort((a, b) => a - b);
  displayed.actors = actorIds.map(id => {
    const old = actorMap.get(id) || {};
    return {
      ...old,
      id,
      name: nameFromDb('actors', id) || old.name || '',
      level: old.level ?? '',
      hp: old.hp ?? '',
      mp: old.mp ?? ''
    };
  });
  return displayed;
}

function renderArchiveInfo(info) {
  $('archiveInfo').textContent = JSON.stringify({
    archivePath: info.archivePath,
    version: info.version,
    fileCount: info.fileCount,
    dataFileCount: info.dataFileCount,
    extracted: info.extracted.map(x => x.archiveName),
    databaseNames: summarizeDb(info.db)
  }, null, 2);
}

function renderSaveInfo(save) {
  const display = decorateSave(save);
  $('saveInfo').textContent = JSON.stringify({
    savePath: save.save_path,
    archiveNamesLoaded: !!currentDb(),
    marshalObjectCount: save.marshal_object_count,
    contentsIndex: save.contents_index,
    contentsKeys: save.contents_keys,
    gold: save.gold,
    variables: display.variables?.length || 0,
    switches: display.switches?.length || 0,
    items: display.items?.length || 0,
    weapons: display.weapons?.length || 0,
    armors: display.armors?.length || 0,
    actors: display.actors?.length || 0
  }, null, 2);
}

function clearTable(tableId) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = '';
  return tbody;
}

function input(value, type = 'text', className = '') {
  const el = document.createElement('input');
  el.type = type;
  el.value = value ?? '';
  if (className) el.className = className;
  return el;
}

function checkbox(value) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = !!value;
  return el;
}

function tdText(text, className = '') {
  const td = document.createElement('td');
  td.textContent = text ?? '';
  if (className) td.className = className;
  return td;
}

function tdChild(child, className = '') {
  const td = document.createElement('td');
  td.appendChild(child);
  if (className) td.className = className;
  return td;
}

function addVariableRow(row) {
  const tbody = document.querySelector('#variablesTable tbody');
  const tr = document.createElement('tr');
  tr.dataset.id = row.id;
  tr.appendChild(tdText(row.id, 'id'));
  tr.appendChild(tdText(row.name, 'name'));
  tr.appendChild(tdChild(input(row.value ?? '', 'text', 'valueInput')));
  tr.appendChild(tdText(row.type || ''));
  tbody.appendChild(tr);
}

function addSwitchRow(row) {
  const tbody = document.querySelector('#switchesTable tbody');
  const tr = document.createElement('tr');
  tr.dataset.id = row.id;
  tr.appendChild(tdText(row.id, 'id'));
  tr.appendChild(tdText(row.name, 'name'));
  tr.appendChild(tdChild(checkbox(row.value), 'switchCell'));
  tbody.appendChild(tr);
}

function addInventoryRow(tableId, row = { id: '', name: '', count: 1 }) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  const tr = document.createElement('tr');
  tr.appendChild(tdChild(input(row.id ?? '', 'number', 'idInput'), 'id'));
  tr.appendChild(tdText(row.name ?? '', 'name'));
  tr.appendChild(tdChild(input(row.count ?? 1, 'number', 'countInput')));
  tbody.appendChild(tr);
}

function addActorRow(row) {
  const tbody = document.querySelector('#actorsTable tbody');
  const tr = document.createElement('tr');
  tr.dataset.id = row.id;
  tr.appendChild(tdText(row.id, 'id'));
  tr.appendChild(tdText(row.name, 'name'));
  tr.appendChild(tdChild(input(row.level ?? '', 'number', 'levelInput')));
  tr.appendChild(tdChild(input(row.hp ?? '', 'number', 'hpInput')));
  tr.appendChild(tdChild(input(row.mp ?? '', 'number', 'mpInput')));
  tbody.appendChild(tr);
}

function renderSave(save) {
  const display = decorateSave(save);
  $('editorPanel').classList.remove('hidden');
  $('goldInput').value = display.gold ?? 0;

  clearTable('variablesTable');
  (display.variables || []).forEach(addVariableRow);
  clearTable('switchesTable');
  (display.switches || []).forEach(addSwitchRow);
  clearTable('itemsTable');
  (display.items || []).forEach(row => addInventoryRow('itemsTable', row));
  clearTable('weaponsTable');
  (display.weapons || []).forEach(row => addInventoryRow('weaponsTable', row));
  clearTable('armorsTable');
  (display.armors || []).forEach(row => addInventoryRow('armorsTable', row));
  clearTable('actorsTable');
  (display.actors || []).forEach(addActorRow);
  applyFilter();
}

function tableRows(tableId) {
  return Array.from(document.querySelectorAll(`#${tableId} tbody tr`));
}

function cellText(tr, selector) {
  const el = tr.querySelector(selector);
  return el?.textContent?.trim() || '';
}

function collectVariables() {
  return tableRows('variablesTable').map(tr => ({
    id: Number(tr.dataset.id),
    name: cellText(tr, '.name'),
    value: tr.querySelector('.valueInput').value,
    type: tr.children[3]?.textContent?.trim() || ''
  })).filter(x => Number.isFinite(x.id) && x.id > 0);
}

function collectSwitches() {
  return tableRows('switchesTable').map(tr => ({
    id: Number(tr.dataset.id),
    name: cellText(tr, '.name'),
    value: tr.querySelector('input[type="checkbox"]').checked
  })).filter(x => Number.isFinite(x.id) && x.id > 0);
}

function collectInventory(tableId) {
  return tableRows(tableId).map(tr => ({
    id: Number(tr.querySelector('.idInput').value),
    name: cellText(tr, '.name'),
    count: Number(tr.querySelector('.countInput').value)
  })).filter(x => Number.isFinite(x.id) && x.id > 0 && Number.isFinite(x.count));
}

function collectActors() {
  return tableRows('actorsTable').map(tr => ({
    id: Number(tr.dataset.id),
    name: cellText(tr, '.name'),
    level: tr.querySelector('.levelInput').value,
    hp: tr.querySelector('.hpInput').value,
    mp: tr.querySelector('.mpInput').value
  })).filter(x => Number.isFinite(x.id) && x.id > 0);
}

function collectPatch() {
  return {
    gold: Number($('goldInput').value || 0),
    variables: collectVariables(),
    switches: collectSwitches(),
    items: collectInventory('itemsTable'),
    weapons: collectInventory('weaponsTable'),
    armors: collectInventory('armorsTable'),
    actors: collectActors()
  };
}

function syncCurrentSaveFromDom() {
  if (!currentSave || $('editorPanel').classList.contains('hidden')) return;
  const patch = collectPatch();
  currentSave.gold = patch.gold;
  currentSave.variables = patch.variables;
  currentSave.switches = patch.switches;
  currentSave.items = patch.items;
  currentSave.weapons = patch.weapons;
  currentSave.armors = patch.armors;
  currentSave.actors = patch.actors;
}

function setActiveTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.tabContent').forEach(el => el.classList.toggle('active', el.id === `tab-${tab}`));
  applyFilter();
}

function activeTableId() {
  return `${activeTab}Table`;
}

function applyFilter() {
  const tableId = activeTableId();
  const q = $('filterInput').value.trim().toLowerCase();
  const rows = document.querySelectorAll(`#${tableId} tbody tr`);
  rows.forEach(tr => {
    const text = tr.innerText.toLowerCase() + ' ' + Array.from(tr.querySelectorAll('input')).map(i => i.type === 'checkbox' ? String(i.checked) : i.value).join(' ').toLowerCase();
    tr.style.display = !q || text.includes(q) ? '' : 'none';
  });
}

$('chooseArchive').addEventListener('click', async () => {
  const p = await window.bsEditor.selectArchive();
  if (p) $('archivePath').value = p;
});

$('chooseSave').addEventListener('click', async () => {
  const p = await window.bsEditor.selectSave();
  if (p) $('savePath').value = p;
});

$('loadArchive').addEventListener('click', async () => {
  const p = $('archivePath').value;
  if (!p) return setStatus('Choose Game.rgss3a first.', true);
  try {
    syncCurrentSaveFromDom();
    setStatus('Reading Game.rgss3a and extracting database names...');
    currentArchiveInfo = await window.bsEditor.loadArchive(p);
    renderArchiveInfo(currentArchiveInfo);
    if (currentSave) {
      renderSaveInfo(currentSave);
      renderSave(currentSave);
      setStatus('Archive database loaded. Existing save rows now show database names.');
    } else {
      setStatus('Archive database loaded. You can also load Save*.rvdata2 without this step.');
    }
  } catch (e) {
    setStatus(e.message, true);
  }
});

$('loadSave').addEventListener('click', async () => {
  const p = $('savePath').value;
  if (!p) return setStatus('Choose Save*.rvdata2 first.', true);
  try {
    setStatus('Loading save file. Game.rgss3a is optional and not required.');
    currentSave = await window.bsEditor.loadSave(p);
    renderSaveInfo(currentSave);
    renderSave(currentSave);
    setStatus(currentDb() ? 'Save loaded with archive names applied.' : 'Save loaded by ID only. Load Game.rgss3a later to apply names.');
  } catch (e) {
    setStatus(e.message, true);
  }
});

$('writeSave').addEventListener('click', async () => {
  const p = $('savePath').value;
  if (!p || !currentSave) return setStatus('Load a save first.', true);
  const confirmed = confirm('This will create a timestamped .bak file, then overwrite the selected save. Continue?');
  if (!confirmed) return;
  try {
    syncCurrentSaveFromDom();
    setStatus('Writing save and creating backup...');
    const result = await window.bsEditor.writeSave(p, collectPatch());
    setStatus(`Saved. Backup: ${result.backup}`);
    currentSave = await window.bsEditor.loadSave(p);
    renderSaveInfo(currentSave);
    renderSave(currentSave);
  } catch (e) {
    setStatus(e.message, true);
  }
});

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

$('filterInput').addEventListener('input', applyFilter);
$('clearFilter').addEventListener('click', () => { $('filterInput').value = ''; applyFilter(); });
$('addItem').addEventListener('click', () => addInventoryRow('itemsTable'));
$('addWeapon').addEventListener('click', () => addInventoryRow('weaponsTable'));
$('addArmor').addEventListener('click', () => addInventoryRow('armorsTable'));
