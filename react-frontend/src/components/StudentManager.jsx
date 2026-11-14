import { downloadBlob } from '../lib/download';
import { appFetch } from '../lib/transport';
import { authFetch as fetch } from '../lib/api';
import React, { useState, useEffect } from 'react';
import {
  IconUsers,
  IconPlus,
  IconSearch,
  IconAlert,
  IconCheck,
  IconClipboard,
  IconTrash,
  IconX,
} from './icons';

const YEARS = ['All', 'FE', 'SE', 'TE', 'BE'];
const DIVISIONS = ['All', 'A', 'B', 'C', 'D', 'E'];
const BRANCHES = ['All', 'Common', 'CE', 'IT', 'MECH', 'ENTC', 'Civil'];

export default function StudentManager() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [activeTab, setActiveTab] = useState('list'); // 'list' | 'single' | 'bulk'

  // Filters
  const [filterYear, setFilterYear] = useState('All');
  const [filterDivision, setFilterDivision] = useState('All');
  const [filterBranch, setFilterBranch] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Single Student Form
  const [formName, setFormName] = useState('');
  const [formYear, setFormYear] = useState('FE');
  const [formBranch, setFormBranch] = useState('Common');
  const [formDivision, setFormDivision] = useState('A');
  const [formBatch, setFormBatch] = useState('A1');
  const [formRoll, setFormRoll] = useState('');
  const [submittingSingle, setSubmittingSingle] = useState(false);

  // Edit Student State
  const [editingStudent, setEditingStudent] = useState(null);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Bulk Student Form
  const [bulkInput, setBulkInput] = useState('');
  const [submittingBulk, setSubmittingBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const [credentials,setCredentials]=useState([]);
  const rememberCredentials = issued => setCredentials(old => [...old.filter(c => !issued.some(n => n.access_code === c.access_code)), ...issued]);
  const [copiedCode, setCopiedCode] = useState(null);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  const getToken = () =>
    localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterYear !== 'All') params.append('academic_year', filterYear);
      if (filterBranch !== 'All') params.append('branch', filterBranch);
      if (filterDivision !== 'All') params.append('division', filterDivision);

      const res = await appFetch(`/api/students?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok && data.students) {
        setStudents(data.students);
      } else { showMsg(data.error || 'Could not load the student directory.', 'error'); }
    } catch (err) {
      console.error('Failed to fetch students', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, [filterYear, filterDivision, filterBranch]);

  // Handle single student submit
  const handleSingleSubmit = async (e) => {
    e.preventDefault();
    if (!formName.trim() || !formRoll.trim()) {
      showMsg('Student name and roll number are required.', 'error');
      return;
    }

    setSubmittingSingle(true);
    try {
      const payload = {
        name: formName.trim(),
        academic_year: formYear,
        branch: formYear === 'FE' ? 'Common' : formBranch,
        division: formDivision,
        batch: formBatch,
        roll_number: formRoll.trim()
      };

      const res = await appFetch('/api/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.student) {
        rememberCredentials([data.student]);
        showMsg('Student enrolled. Share the invitation below privately.', 'success');
        setFormName('');
        setFormRoll('');
        setActiveTab('list');
        fetchStudents();
      } else {
        showMsg(data.error || 'Failed to create student.', 'error');
      }
    } catch (err) {
      showMsg('Network error while saving student.', 'error');
    } finally {
      setSubmittingSingle(false);
    }
  };

  // Handle edit submit
  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingStudent) return;

    setSubmittingEdit(true);
    try {
      const res = await appFetch(`/api/students/${editingStudent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify(editingStudent)
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('Student updated successfully!', 'success');
        setEditingStudent(null);
        fetchStudents();
      } else {
        showMsg(data.error || 'Failed to update student.', 'error');
      }
    } catch (err) {
      showMsg('Network error updating student.', 'error');
    } finally {
      setSubmittingEdit(false);
    }
  };

  // Handle delete student
  const handleDeleteStudent = async (studentId, studentName) => {
    if (!window.confirm(`Are you sure you want to remove student "${studentName}"? This will also remove their attendance history.`)) {
      return;
    }

    setActionLoadingId(studentId);
    try {
      const res = await appFetch(`/api/students/${studentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) {
        showMsg(`Student "${studentName}" deleted successfully.`, 'success');
        fetchStudents();
      } else {
        showMsg(data.error || 'Failed to delete student.', 'error');
      }
    } catch (err) {
      showMsg('Network error deleting student.', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handle regenerate access code
  const handleRegenerateCode = async (studentId, studentName) => {
    if (!window.confirm(`Issue a new registration code for ${studentName}? Their existing password will stop working. Verify their identity first.`)) return;
    setActionLoadingId(studentId);
    try {
      const res = await appFetch(`/api/students/${studentId}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) {
        rememberCredentials([{name:studentName,...data}]);
        showMsg('New registration code ready. Share it privately.', 'success');
        fetchStudents();
      } else {
        showMsg(data.error || 'Failed to regenerate code.', 'error');
      }
    } catch (err) {
      showMsg('Network error regenerating access code.', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Bulk student submit
  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    const lines = bulkInput.trim().split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) {
      showMsg('Please paste at least one student record.', 'error');
      return;
    }

    const parsedList = [];
    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 6) {
        parsedList.push({
          name: parts[0],
          academic_year: parts[1].toUpperCase(),
          branch: parts[2],
          division: parts[3].toUpperCase(),
          batch: parts[4].toUpperCase(),
          roll_number: parts[5]
        });
      }
    }

    if (parsedList.length === 0) {
      showMsg('Invalid CSV format. Use: Name, Year, Branch, Division, Batch, RollNumber', 'error');
      return;
    }

    setSubmittingBulk(true);
    try {
      const res = await appFetch('/api/students/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({ students: parsedList })
      });
      const data = await res.json();
      if (res.ok) {
        setBulkResult(data);
        rememberCredentials(data.created || []);
        showMsg(`Enrolled ${data.createdCount} students successfully!`, 'success');
        setBulkInput('');
        fetchStudents();
      } else {
        showMsg(data.error || 'Bulk enrollment failed.', 'error');
      }
    } catch (err) {
      showMsg('Network error during bulk import.', 'error');
    } finally {
      setSubmittingBulk(false);
    }
  };

  const copyToClipboard = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const displayedStudents = students.filter(s => {
    const q = searchQuery.toLowerCase();
    const name = (s.name || s.NAME || '').toLowerCase();
    const code = (s.access_code || s.ACCESS_CODE || '').toLowerCase();
    const roll = String(s.roll_number || s.ROLL_NUMBER || '');
    return name.includes(q) || code.includes(q) || roll.includes(q);
  });

  const exportStudents = () => {
    const cell = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, m => "'"+m).replaceAll('"','""') + '"';
    const rows = [['Name','Year','Branch','Division','Batch','Roll number','Registration code','Email','Account status'], ...displayedStudents.map(s=>[
      s.name??s.NAME,s.academic_year??s.ACADEMIC_YEAR,s.branch??s.BRANCH,s.division??s.DIVISION,s.batch??s.BATCH,s.roll_number??s.ROLL_NUMBER,s.registration_code??s.REGISTRATION_CODE??'',s.email??s.EMAIL??'',Number(s.is_first_login??s.IS_FIRST_LOGIN)===0?'Registered':'Awaiting registration'
    ])];
    const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    downloadBlob(blob,'student-invitations-'+filterYear+'-'+filterDivision+'.csv').catch(e=>setMessage({text:e.message,type:'error'}));
  };
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="paper-card"><button className="secondary-btn" disabled={loading||!displayedStudents.length} onClick={exportStudents}>Export filtered students and registration codes</button><p>Filter by year, division and branch before exporting. Give each student their private registration code. Students create their own email and password accounts.</p></div>
      {credentials.length>0&&<section className="paper-card" aria-label="Student invitations"><div className="section-heading"><h3>Private student invitations</h3><button type="button" className="secondary-btn" onClick={()=>setCredentials([])}>Dismiss</button></div><p>Share each registration code privately. The student uses Create Account to enter their email, password and code.</p>{credentials.map(c=><div key={c.access_code} className="paper-card my-3"><strong>{c.name}</strong><p>Registration code: <code>{c.registration_code}</code></p><button className="secondary-btn" onClick={()=>navigator.clipboard.writeText('StudyFlow registration code: '+c.registration_code).catch(()=>showMsg('Copy unavailable. Select the invitation text manually.','error'))}>Copy invitation</button></div>)}</section>}

      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
            Enrollment Directory
          </span>
          <h2 className="text-2xl font-black text-indigo-900 mt-2">Student Directory</h2>
          <p className="text-xs text-slate-500 mt-1">
            Manage student profiles, issue secure invitations, and enroll your class.
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold self-start md:self-auto">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'list' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-indigo-900'
            }`}
          >
            Roster ({students.length})
          </button>
          <button
            onClick={() => setActiveTab('single')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'single' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-indigo-900'
            }`}
          >
            + Enroll Single
          </button>
          <button
            onClick={() => setActiveTab('bulk')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              activeTab === 'bulk' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-indigo-900'
            }`}
          >
            Bulk Import
          </button>
        </div>
      </div>

      {message.text && (
        <div
          className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <IconCheck className="w-4 h-4 shrink-0 text-emerald-600" />
          ) : (
            <IconAlert className="w-4 h-4 shrink-0 text-red-600" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Tab 1: Student Roster List */}
      {activeTab === 'list' && (
        <div className="bg-white p-6 rounded-2xl border border-indigo-200/70 shadow-sm space-y-4">
          {/* Filter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pb-4 border-b border-slate-100">
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Year</label>
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
              >
                {YEARS.map(y => <option key={y} value={y}>{y === 'All' ? 'All Years' : y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Division</label>
              <select
                value={filterDivision}
                onChange={(e) => setFilterDivision(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
              >
                {DIVISIONS.map(d => <option key={d} value={d}>{d === 'All' ? 'All Divisions' : `Division ${d}`}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Branch</label>
              <select
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800"
              >
                {BRANCHES.map(b => <option key={b} value={b}>{b === 'All' ? 'All Branches' : b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Search Name / Code</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Roll, Name, Code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-2 pl-8 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
                />
                <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              </div>
            </div>
          </div>

          {/* Student Table */}
          {loading ? (
            <div className="text-center py-12 text-slate-400 text-xs">Loading student roster...</div>
          ) : displayedStudents.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              No students found matching your criteria. Click "+ Enroll Single" or "Bulk Import" to add students.
            </div>
          ) : (
            <div className="overflow-x-auto student-roster">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                    <th className="py-2.5 px-3">Roll</th>
                    <th className="py-2.5 px-3">Student Name</th>
                    <th className="py-2.5 px-3">Year / Branch</th>
                    <th className="py-2.5 px-3">Div / Batch</th>
                    <th className="py-2.5 px-3">Registration code</th><th className="py-2.5 px-3">Account</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayedStudents.map((s) => {
                    const id = s.id ?? s.ID;
                    const roll = s.roll_number ?? s.ROLL_NUMBER;
                    const name = s.name ?? s.NAME;
                    const year = s.academic_year ?? s.ACADEMIC_YEAR;
                    const br = s.branch ?? s.BRANCH;
                    const div = s.division ?? s.DIVISION;
                    const batch = s.batch ?? s.BATCH;
                    const code = s.registration_code ?? s.REGISTRATION_CODE ?? ''; 
                    const isBusy = actionLoadingId === id;

                    return (
                      <tr key={id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3 font-mono font-bold text-slate-800">{roll}</td>
                        <td className="py-3 px-3 font-bold text-indigo-950">{name}</td>
                        <td className="py-3 px-3 text-slate-600 font-semibold">{year} · {br}</td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-bold">
                            Div {div} - {batch}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono font-black text-indigo-600">{code||(Number(s.is_first_login??s.IS_FIRST_LOGIN)===0?"Registered":"Reissue code to register")}</td><td className="py-3 px-3">{s.email??s.EMAIL??"Awaiting registration"}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {/* Copy Code */}
                            <button
                              type="button"
                              disabled={!code}
                              onClick={() => copyToClipboard(code)}
                              className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[11px] font-bold transition-all border border-indigo-200/60 inline-flex items-center gap-1"
                              title="Copy student access code"
                            >
                              <IconClipboard className="w-3 h-3" />
                              <span>{copiedCode === code ? 'Copied' : 'Copy'}</span>
                            </button>

                            {/* Edit Button */}
                            <button
                              type="button"
                              onClick={() => setEditingStudent({
                                id,
                                name,
                                academic_year: year,
                                branch: br,
                                division: div,
                                batch,
                                roll_number: roll
                              })}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition-all"
                            >
                              Edit
                            </button>

                            {/* Regenerate Code */}
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRegenerateCode(id, name)}
                              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg text-[11px] font-bold transition-all border border-amber-200"
                              title="Reset student password"
                            >
                              Reissue registration code
                            </button>

                            {/* Delete Button */}
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDeleteStudent(id, name)}
                              className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                              title="Delete student"
                            >
                              <IconTrash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-indigo-100 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-black text-indigo-950">Edit Student Record</h3>
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Student Full Name</label>
                <input
                  type="text"
                  required
                  value={editingStudent.name}
                  onChange={(e) => setEditingStudent({ ...editingStudent, name: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Roll Number</label>
                  <input
                    type="text"
                    required
                    value={editingStudent.roll_number}
                    onChange={(e) => setEditingStudent({ ...editingStudent, roll_number: e.target.value })}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Year</label>
                  <select
                    value={editingStudent.academic_year}
                    onChange={(e) => setEditingStudent({
                      ...editingStudent,
                      academic_year: e.target.value,
                      branch: e.target.value === 'FE' ? 'Common' : editingStudent.branch
                    })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    {['FE', 'SE', 'TE', 'BE'].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Branch</label>
                  {editingStudent.academic_year === 'FE' ? (
                    <div className="px-3 py-2 bg-slate-100 rounded-xl text-xs text-slate-500 font-semibold">Common</div>
                  ) : (
                    <select
                      value={editingStudent.branch}
                      onChange={(e) => setEditingStudent({ ...editingStudent, branch: e.target.value })}
                      className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                    >
                      {['CE', 'IT', 'MECH', 'ENTC', 'Civil'].map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Division</label>
                  <select
                    value={editingStudent.division}
                    onChange={(e) => setEditingStudent({ ...editingStudent, division: e.target.value })}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    {['A', 'B', 'C', 'D', 'E'].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Batch</label>
                  <input
                    type="text"
                    required
                    value={editingStudent.batch}
                    onChange={(e) => setEditingStudent({ ...editingStudent, batch: e.target.value.toUpperCase() })}
                    className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                Note: Updating academic year, division, batch or roll number automatically recalculates the student's unique access code.
              </p>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingEdit}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                >
                  {submittingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tab 2: Single Student Form */}
      {activeTab === 'single' && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-indigo-200/70 shadow-sm">
          <h3 className="text-base font-bold text-indigo-900 mb-4 flex items-center gap-2">
            <IconPlus className="w-4 h-4 text-indigo-600" />
            <span>Enroll New Student</span>
          </h3>
          <p className="text-xs text-slate-500 mb-6">
            The system will automatically generate their unique Division Access Code (e.g. <code>FE-E-E1-36</code> or <code>SE-CE-A-A1-12</code>).
          </p>

          <form onSubmit={handleSingleSubmit} className="space-y-4 max-w-xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Student Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Roll Number</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 36"
                  value={formRoll}
                  onChange={(e) => setFormRoll(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Year</label>
                <select
                  value={formYear}
                  onChange={(e) => {
                    setFormYear(e.target.value);
                    if (e.target.value === 'FE') setFormBranch('Common');
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                >
                  {['FE', 'SE', 'TE', 'BE'].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Branch</label>
                {formYear === 'FE' ? (
                  <div className="px-3 py-2 bg-slate-100 rounded-xl text-xs text-slate-500 font-semibold">Common</div>
                ) : (
                  <select
                    value={formBranch}
                    onChange={(e) => setFormBranch(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  >
                    {['CE', 'IT', 'MECH', 'ENTC', 'Civil'].map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Division</label>
                <select
                  value={formDivision}
                  onChange={(e) => setFormDivision(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                >
                  {['A', 'B', 'C', 'D', 'E'].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Lab Batch</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. E1"
                  value={formBatch}
                  onChange={(e) => setFormBatch(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold font-mono"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="submit"
                disabled={submittingSingle}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-indigo-600/25 disabled:opacity-50"
              >
                {submittingSingle ? 'Saving...' : 'Generate Access Code & Enroll'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-200"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 3: Bulk Import */}
      {activeTab === 'bulk' && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-indigo-200/70 shadow-sm space-y-4">
          <h3 className="text-base font-bold text-indigo-900 flex items-center gap-2">
            <IconUsers className="w-4 h-4 text-indigo-600" />
            <span>Bulk Student Import (CSV format)</span>
          </h3>
          <p className="text-xs text-slate-500">
            Paste rows with format: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-bold">Name, AcademicYear, Branch, Division, Batch, RollNumber</code>
          </p>

          <form onSubmit={handleBulkSubmit} className="space-y-4">
            <textarea
              rows={6}
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder="Rahul Sharma, FE, Common, E, E1, 01&#10;Pooja Patil, FE, Common, E, E1, 02&#10;Amit Deshmukh, SE, CE, A, A1, 12"
              className="w-full p-4 font-mono text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-indigo-500 leading-relaxed"
            />

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submittingBulk}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-indigo-600/25 disabled:opacity-50"
              >
                {submittingBulk ? 'Enrolling...' : 'Import Students'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                className="px-4 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs hover:bg-slate-200"
              >
                Back to Roster
              </button>
            </div>
          </form>

          {bulkResult && (
            <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
              <p className="font-bold text-indigo-900">
                Bulk Import Summary: {bulkResult.createdCount} created, {bulkResult.failedCount} failed.
              </p>
              {bulkResult.failed && bulkResult.failed.length > 0 && (
                <ul className="text-red-600 text-[11px] list-disc list-inside">
                  {bulkResult.failed.map((f, i) => (
                    <li key={i}>{f.name}: {f.error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
