// Browser-safe configuration only. The publishable key is intended for frontend use.
// Never place a Supabase secret/service-role key in this file.
const SUPABASE_URL = 'https://rafwarhtybmljuflcaex.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_8sHgcVY8jFdrRfRreNJJHw_yDo7rR_2';

const HOLIDAYS = {
  '2026-11-08': 'Diwali Laxmi Pujan',
  '2026-11-10': 'Diwali-Balipratipada',
  '2026-11-24': 'Prakash Gurpurab Sri Guru Nanak Dev',
  '2026-12-25': 'Christmas'
};

const $ = (id) => document.getElementById(id);
let supabaseClient, currentUser, currentProfile, currentRole = 'user';
let currentRows = [], autoSaveTimer = null, sessionStarting = false, recoveryMode = false;

const monthKey = () => $('month')?.value || new Date().toISOString().slice(0, 7);
const dateKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const isAdminPage = document.body.dataset.page === 'admin';

function dayType(date) {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  if (weekday === 0 || weekday === 6) return 'Weekend';
  if (HOLIDAYS[date]) return 'Holiday';
  return 'Working';
}
function rowClass(type) {
  if (type === 'Weekend') return 'weekend';
  if (type === 'Holiday') return 'holiday';
  if (['Personal leave', 'Emergency leave', 'Paternity leave'].includes(type)) return 'leave';
  return 'working';
}
function displayType(row) {
  if (row.day_type === 'Weekend') return 'Weekend';
  if (row.day_type === 'Holiday') return `Holiday - ${HOLIDAYS[row.work_date]}`;
  return ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(row.day_status) ? row.day_status : 'Working';
}
function say(id, message) {
  const el = $(id);
  if (el) el.textContent = message;
}
function setSignedIn(on) {
  $('auth-panel')?.classList.toggle('hidden', on);
  $('app-panel')?.classList.toggle('hidden', !on);
  $('admin-page-panel')?.classList.toggle('hidden', !on || currentRole !== 'admin');
  const sessionArea = $('session-area');
  if (sessionArea) {
    sessionArea.replaceChildren();
    if (on) {
      const btn = document.createElement('button');
      btn.className = 'secondary';
      btn.textContent = 'Sign out';
      btn.onclick = signOut;
      sessionArea.append(btn);
    }
  }
}
async function init() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || SUPABASE_URL.includes('YOUR_') || SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')) {
    $('setup-warning')?.classList.remove('hidden');
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  $('login-form')?.addEventListener('submit', login);
  $('forgot-password')?.addEventListener('click', requestPasswordReset);
  $('reset-password-form')?.addEventListener('submit', updatePassword);
  $('load-month')?.addEventListener('click', loadMonth);
  $('save-all')?.addEventListener('click', saveRows);
  $('export-own')?.addEventListener('click', exportOwn);
  $('invite-form')?.addEventListener('submit', inviteUser);
  $('export-form')?.addEventListener('submit', adminExport);
  $('refresh-users')?.addEventListener('click', loadUsers);

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      $('auth-panel')?.classList.add('hidden');
      $('app-panel')?.classList.add('hidden');
      $('admin-page-panel')?.classList.add('hidden');
      $('password-reset-panel')?.classList.remove('hidden');
      say('reset-message', 'Enter a new password for your account.');
      return;
    }
    if (session && !recoveryMode) startSession(session.user);
    else if (!session) {
      currentUser = null;
      currentProfile = null;
      currentRole = 'user';
      setSignedIn(false);
    }
  });
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && !recoveryMode) await startSession(session.user);
}
async function login(event) {
  event.preventDefault();
  say('auth-message', 'Signing in…');
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value
  });
  say('auth-message', error ? error.message : 'Signed in. Loading your timesheet…');
}

async function requestPasswordReset() {
  const email = $('email')?.value.trim();
  if (!email) {
    say('auth-message', 'Enter your registered email address first.');
    $('email')?.focus();
    return;
  }
  say('auth-message', 'Sending password reset email…');
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
  say('auth-message', error
    ? `Could not send reset email: ${error.message}`
    : 'If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.');
}
async function updatePassword(event) {
  event.preventDefault();
  const password = $('new-password')?.value || '';
  const confirm = $('confirm-password')?.value || '';
  if (password.length < 10) {
    say('reset-message', 'Use a password with at least 10 characters.');
    return;
  }
  if (password !== confirm) {
    say('reset-message', 'The passwords do not match.');
    return;
  }
  say('reset-message', 'Updating password…');
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    say('reset-message', `Password update failed: ${error.message}`);
    return;
  }
  recoveryMode = false;
  await supabaseClient.auth.signOut();
  $('password-reset-panel')?.classList.add('hidden');
  $('auth-panel')?.classList.remove('hidden');
  $('reset-password-form')?.reset();
  say('auth-message', 'Your password has been updated. Please sign in with your new password.');
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}
async function startSession(user) {
  if (sessionStarting) return;
  sessionStarting = true;
  try {
    currentUser = user;
    const { data: profile, error } = await supabaseClient.from('profiles')
      .select('id,full_name,is_active').eq('id', user.id).single();
    if (error || !profile || !profile.is_active) {
      say('auth-message', 'Your account is not active. Contact an administrator.');
      await supabaseClient.auth.signOut();
      return;
    }
    currentProfile = profile;
    const { data: roleData, error: roleError } = await supabaseClient.rpc('current_user_role');
    if (roleError) {
      say('auth-message', 'Could not verify your account permissions.');
      await supabaseClient.auth.signOut();
      return;
    }
    currentRole = roleData || 'user';
    setSignedIn(true);

    if (isAdminPage && currentRole !== 'admin') {
      $('admin-denied')?.classList.remove('hidden');
      return;
    }

    const fullName = currentProfile.full_name || user.email?.split('@')[0] || 'User';
    $('welcome') && ($('welcome').textContent = `Hello, ${fullName}`);
    $('resource-name') && ($('resource-name').textContent = fullName);
    $('role-label') && ($('role-label').textContent = currentRole === 'admin' ? 'Administrator' : 'Personal timesheet');
    $('admin-settings-link')?.classList.toggle('hidden', currentRole !== 'admin');
    if (isAdminPage) {
      $('admin-page-title').textContent = 'Admin Settings';
      $('admin-page-user').textContent = `Signed in as ${fullName}`;
      $('admin-month').value = new Date().toISOString().slice(0, 7);
      $('app-panel')?.classList.add('hidden');
      $('admin-page-panel')?.classList.remove('hidden');
      await loadUsers();
    } else {
      $('month').value = $('month').value || new Date().toISOString().slice(0, 7);
      await loadMonth();
    }
  } finally {
    sessionStarting = false;
  }
}
function buildDates(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const totalDays = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: totalDays }, (_, index) => {
    const date = dateKey(year, monthNumber - 1, index + 1);
    const dayTypeValue = dayType(date);
    return {
      work_date: date,
      day_name: new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }),
      day_type: dayTypeValue,
      day_status: 'Working',
      task: '',
      hours: ''
    };
  });
}
async function loadMonth() {
  if (!currentUser || !$('month')) return;
  const dates = buildDates(monthKey());
  const { data, error } = await supabaseClient.from('timesheets')
    .select('id,user_id,work_date,task,hours,day_status')
    .gte('work_date', dates[0].work_date)
    .lte('work_date', dates[dates.length - 1].work_date)
    .order('work_date');
  if (error) {
    say('save-message', `Could not load timesheet: ${error.message}`);
    return;
  }
  const saved = new Map((data || []).map(row => [row.work_date, row]));
  currentRows = dates.map(dateRow => {
    const existing = saved.get(dateRow.work_date);
    return {
      ...dateRow,
      ...(existing || {}),
      day_status: dateRow.day_type === 'Working' && ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(existing?.day_status) ? existing.day_status : 'Working',
      task: existing ? (existing.task || '') : dateRow.task,
      hours: existing?.hours ?? ''
    };
  });
  renderRows();
}
function renderRows() {
  const body = $('entries');
  if (!body) return;
  body.replaceChildren();
  currentRows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.className = rowClass(row.day_type === 'Working' ? row.day_status : row.day_type);

    const dateCell = document.createElement('td');
    dateCell.textContent = new Date(`${row.work_date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const dayCell = document.createElement('td');
    dayCell.textContent = row.day_name;
    const typeCell = document.createElement('td');

    if (row.day_type === 'Working') {
      const status = document.createElement('select');
      status.setAttribute('aria-label', `Day status for ${row.work_date}`);
      for (const value of ['Working', 'Personal leave', 'Emergency leave', 'Paternity leave']) status.add(new Option(value, value));
      status.value = row.day_status;
      status.addEventListener('change', () => {
        currentRows[index].day_status = status.value;
        tr.className = rowClass(status.value);
        updateKPIs();
        scheduleAutoSave();
      });
      typeCell.append(status);
    } else {
      typeCell.textContent = displayType(row);
    }

    const taskCell = document.createElement('td');
    const taskInput = document.createElement('input');
    taskInput.maxLength = 1000;
    taskInput.value = row.task || '';
    taskInput.placeholder = 'Enter task description';
    taskInput.addEventListener('input', () => {
      currentRows[index].task = taskInput.value;
      scheduleAutoSave();
    });
    taskCell.append(taskInput);

    const hoursCell = document.createElement('td');
    const hoursInput = document.createElement('input');
    hoursInput.type = 'number';
    hoursInput.min = '0';
    hoursInput.max = '24';
    hoursInput.step = '0.25';
    hoursInput.value = row.hours ?? '';
    hoursInput.placeholder = '0';
    hoursInput.addEventListener('input', () => {
      currentRows[index].hours = hoursInput.value;
      updateKPIs();
      scheduleAutoSave();
    });
    hoursCell.append(hoursInput);
    tr.append(dateCell, dayCell, typeCell, taskCell, hoursCell);
    body.append(tr);
  });
  updateKPIs();
}
function updateKPIs() {
  const total = currentRows.reduce((sum, row) => sum + (Number(row.hours) || 0), 0);
  const [year, monthNumber] = monthKey().split('-').map(Number);
  const totalDays = new Date(year, monthNumber, 0).getDate();
  // Scheduled working days exclude only Saturdays, Sundays and public holidays.
  // Leave is reported separately and does not reduce the monthly hours target.
  const workingDays = currentRows.filter(row => row.day_type === 'Working').length;
  const monthlyTarget = workingDays * 8;
  const holidays = currentRows.filter(row => row.day_type === 'Holiday');
  const leaveDays = currentRows.filter(row => row.day_type === 'Working' && ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(row.day_status)).length;
  $('total-hours').textContent = `${formatHours(total)} / ${monthlyTarget}`;
  $('hours-target-note').textContent = `Target: ${workingDays} working days × 8 hours`;
  $('holiday-count').textContent = String(holidays.length);
  $('holiday-dates').textContent = holidays.map(row => {
    const date = new Date(`${row.work_date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    return `${date} - ${HOLIDAYS[row.work_date]}`;
  }).join(', ') || 'No holidays';
  $('working-days').textContent = `${workingDays} / ${totalDays}`;
  $('leave-count').textContent = String(leaveDays);
  $('leave-types').textContent = leaveDays ? currentRows.filter(row => row.day_type === 'Working' && ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(row.day_status)).map(row => `${new Date(`${row.work_date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} - ${row.day_status}`).join(', ') : 'No leaves';
  if ($('resource-name')) $('resource-name').textContent = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'User';
}
function formatHours(value) {
  return Number(value.toFixed(2)).toString();
}
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  say('save-message', 'Unsaved changes — saving automatically…');
  autoSaveTimer = setTimeout(saveRows, 1200);
}
async function saveRows() {
  if (!currentUser) return;
  clearTimeout(autoSaveTimer);
  const payload = currentRows.map(row => ({
    user_id: currentUser.id,
    work_date: row.work_date,
    task: (row.task || '').trim(),
    hours: row.hours === '' || row.hours == null ? null : Number(row.hours),
    day_status: row.day_type === 'Working' ? row.day_status : 'Working'
  }));
  if (payload.some(row => row.hours !== null && (!Number.isFinite(row.hours) || row.hours < 0 || row.hours > 24))) {
    say('save-message', 'Hours must be between 0 and 24.');
    return;
  }
  const { error } = await supabaseClient.from('timesheets').upsert(payload, { onConflict: 'user_id,work_date' });
  say('save-message', error ? `Save failed: ${error.message}` : 'All entries saved successfully.');
  if (!error) await loadMonth();
}
function addRowsToWorksheet(workbook, rows, sheetName = 'Timesheet', fallbackResourceName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'User') {
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 16 },
    { header: 'Resource', key: 'resource', width: 20 },
    { header: 'Task', key: 'task', width: 58 },
    { header: 'Hour', key: 'hours', width: 12 }
  ];
  worksheet.getRow(1).height = 24;
  worksheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102B50' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD6E2' } } };
  });

  let totalHours = 0;
  rows.forEach(row => {
    const type = row.day_type || dayType(row.work_date);
    const holidayName = HOLIDAYS[row.work_date];
    const leaveType = ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(row.day_status) ? row.day_status : '';
    const taskText = type === 'Holiday' ? (row.task ? `${row.task} (Holiday - ${holidayName})` : `Holiday - ${holidayName}`) : type === 'Weekend' ? (row.task || 'Weekend') : leaveType ? (row.task ? `${row.task} (${leaveType})` : leaveType) : (row.task || '');
    const excelRow = worksheet.addRow({
      date: new Date(`${row.work_date}T12:00:00`),
      resource: row.resource || fallbackResourceName,
      task: taskText,
      hours: row.hours === '' || row.hours == null ? null : Number(row.hours)
    });
    excelRow.getCell(1).numFmt = 'dd-mmm-yyyy';
    excelRow.getCell(4).numFmt = '0.00';
    totalHours += Number(row.hours) || 0;
    const fill = type === 'Weekend' ? 'FFEAF0F7' : type === 'Holiday' ? 'FFFFF0C2' : ['Personal leave', 'Emergency leave', 'Paternity leave'].includes(row.day_status) ? 'FFFBE5E7' : 'FFFFFFFF';
    excelRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE4EAF1' } } };
    });
  });

  const totalRow = worksheet.addRow({ date: '', resource: '', task: 'TOTAL HOURS', hours: totalHours });
  const totalRowNumber = totalRow.number;
  worksheet.mergeCells(`A${totalRowNumber}:C${totalRowNumber}`);
  worksheet.getCell(`A${totalRowNumber}`).value = 'TOTAL HOURS';
  worksheet.getCell(`D${totalRowNumber}`).value = totalHours;
  worksheet.getCell(`D${totalRowNumber}`).numFmt = '0.00';
  for (let column = 1; column <= 4; column++) {
    const cell = totalRow.getCell(column);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102B50' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: column === 4 ? 'right' : 'center' };
  }
  totalRow.height = 22;
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: `D${Math.max(1, rows.length + 1)}` };
  return worksheet;
}

function downloadWorkbook(workbook, filename) {
  return workbook.xlsx.writeBuffer().then(buffer => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  });
}

function exportRowsToExcel(rows, filename, sheetName = 'Timesheet', fallbackResourceName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'User') {
  const workbook = new ExcelJS.Workbook();
  addRowsToWorksheet(workbook, rows, sheetName, fallbackResourceName);
  return downloadWorkbook(workbook, filename);
}

function exportAllUsersToExcel(rows, users, filename) {
  const workbook = new ExcelJS.Workbook();
  const grouped = new Map();
  (users || []).forEach(user => grouped.set(user.id, { name: user.full_name || 'User', rows: [] }));
  rows.forEach(row => {
    const key = row.user_id || row.resource || 'unknown';
    if (!grouped.has(key)) grouped.set(key, { name: row.resource || 'User', rows: [] });
    grouped.get(key).rows.push(row);
  });

  const usedNames = new Set();
  for (const [key, group] of grouped.entries()) {
    let baseName = String(group.name || 'User').replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 31) || 'User';
    let sheetName = baseName;
    let suffix = 2;
    while (usedNames.has(sheetName.toLowerCase())) {
      const ending = ` (${suffix++})`;
      sheetName = `${baseName.slice(0, 31 - ending.length)}${ending}`;
    }
    usedNames.add(sheetName.toLowerCase());
    const userRows = group.rows.map(row => ({ ...row, day_type: row.day_type || dayType(row.work_date) }));
    addRowsToWorksheet(workbook, userRows, sheetName, group.name);
  }

  if (!workbook.worksheets.length) addRowsToWorksheet(workbook, [], 'Timesheet');
  return downloadWorkbook(workbook, filename);
}

async function exportOwn() {
  const resourceName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'User';
  const safeName = resourceName.replace(/[^a-z0-9_-]+/gi, '_');
  const filename = `Timesheet_${safeName}_${monthKey()}.xlsx`;
  await exportRowsToExcel(currentRows, filename, 'Timesheet', resourceName);
}
async function inviteUser(event) {
  event.preventDefault();
  say('invite-message', 'Sending invitation…');
  const { data, error } = await supabaseClient.functions.invoke('admin-invite', {
    body: { email: $('invite-email').value.trim(), full_name: $('invite-name').value.trim() }
  });
  say('invite-message', error ? `Invitation failed: ${error.message}` : (data?.message || 'Invitation sent.'));
  if (!error) {
    $('invite-form').reset();
    await loadUsers();
  }
}
async function adminExport(event) {
  event.preventDefault();
  say('export-message', 'Preparing secure export…');
  const { data, error } = await supabaseClient.functions.invoke('admin-export', {
    body: { month: $('admin-month').value, user_id: $('admin-user').value }
  });
  if (error) {
    say('export-message', `Export failed: ${error.message}`);
    return;
  }
  const rows = (data?.rows || []).map(row => ({ ...row, day_type: dayType(row.work_date), day_status: row.day_status || 'Working' }));
  const selectedUser = $('admin-user').value;
  if (selectedUser === 'all') {
    const users = data?.users || [];
    if (!rows.length && !users.length) {
      say('export-message', 'No users or timesheet entries found for this month.');
      return;
    }
    await exportAllUsersToExcel(rows, users, `Timesheets_${$('admin-month').value}_AllUsers.xlsx`);
    say('export-message', `Downloaded ${users.length || new Set(rows.map(row => row.resource)).size} user worksheets.`);
    return;
  }
  if (!rows.length) {
    say('export-message', 'No entries found for this selection.');
    return;
  }
  await exportRowsToExcel(rows, `Timesheets_${$('admin-month').value}_User.xlsx`, rows[0]?.resource || 'Timesheet');
  say('export-message', `Downloaded ${rows.length} entries.`);
}
async function loadUsers() {
  if (currentRole !== 'admin') return;
  const { data, error } = await supabaseClient.from('admin_user_directory')
    .select('id,full_name,email,is_active,role').order('full_name');
  if (error) {
    say('invite-message', `Could not load users: ${error.message}`);
    return;
  }
  const select = $('admin-user');
  if (select) {
    select.replaceChildren(new Option('All users', 'all'));
  }
  const body = $('users-list');
  if (!body) return;
  body.replaceChildren();
  for (const user of data || []) {
    if (select) select.add(new Option(`${user.full_name} (${user.email})`, user.id));
    const tr = document.createElement('tr');
    for (const value of [user.full_name, user.email, user.role, user.is_active ? 'Active' : 'Disabled']) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    const actions = document.createElement('td');
    const statusButton = document.createElement('button');
    statusButton.className = 'secondary';
    statusButton.textContent = user.is_active ? 'Deactivate' : 'Reactivate';
    statusButton.disabled = user.id === currentUser.id && !user.is_active;
    statusButton.onclick = () => toggleUser(user.id, !user.is_active);
    actions.append(statusButton);
    const roleButton = document.createElement('button');
    roleButton.className = 'secondary';
    roleButton.style.marginLeft = '6px';
    roleButton.textContent = user.role === 'admin' ? 'Make user' : 'Make admin';
    roleButton.onclick = () => changeRole(user.id, user.role === 'admin' ? 'user' : 'admin');
    actions.append(roleButton);
    tr.append(actions);
    body.append(tr);
  }
}
async function toggleUser(userId, isActive) {
  if (!confirm(`${isActive ? 'Reactivate' : 'Deactivate'} this account?`)) return;
  const { data, error } = await supabaseClient.functions.invoke('admin-set-user-status', { body: { user_id: userId, is_active: isActive } });
  if (error) { say('invite-message', error.message); return; }
  say('invite-message', data?.message || 'Account status updated.');
  await loadUsers();
}
async function changeRole(userId, role) {
  if (!confirm(`Change this account role to ${role}?`)) return;
  const { data, error } = await supabaseClient.functions.invoke('admin-set-role', { body: { user_id: userId, role } });
  say('invite-message', error ? error.message : (data?.message || 'Role updated.'));
  if (!error) await loadUsers();
}

init();
