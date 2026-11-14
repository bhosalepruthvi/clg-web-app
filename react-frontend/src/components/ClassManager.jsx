import { appFetch } from '../lib/transport';
import { authFetch as fetch } from '../lib/api';
import React, { useState, useEffect } from 'react';

import { IconAlert, IconBook, IconCheck, IconPlus, IconTrash, IconX } from './icons';

export default function ClassManager({ onClassCreated }) {
  // Form State
  const [academicYear, setAcademicYear] = useState('FE');
  const [branch, setBranch] = useState('Common');
  const [division, setDivision] = useState('A');
  const [subjectName, setSubjectName] = useState('');
  const [isLab, setIsLab] = useState(false);
  const [batchTags, setBatchTags] = useState([]);
  const [batchInput, setBatchInput] = useState('');

  // Status & List State
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Edit Class State
  const [editingClass, setEditingClass] = useState(null);
  const [editSubjectName, setEditSubjectName] = useState('');
  const [editBatchInput, setEditBatchInput] = useState('');
  const [editBatches, setEditBatches] = useState([]);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const getToken = () =>
    localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');

  // Academic year change logic
  const handleYearChange = (year) => {
    setAcademicYear(year);
    if (year === 'FE') {
      setBranch('Common');
    } else if (branch === 'Common') {
      setBranch('CE');
    }
  };

  // Pre-fill default batch tags when lab is toggled
  const handleLabToggle = (checked) => {
    setIsLab(checked);
    if (checked && batchTags.length === 0) {
      setBatchTags([`${division}1`, `${division}2`, `${division}3`]);
    }
  };

  const handleAddBatch = (e) => {
    e.preventDefault();
    const tag = batchInput.trim().toUpperCase();
    if (tag && !batchTags.includes(tag)) {
      setBatchTags([...batchTags, tag]);
      setBatchInput('');
    }
  };

  const handleRemoveBatch = (tagToRemove) => {
    setBatchTags(batchTags.filter((t) => t !== tagToRemove));
  };

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

  // Fetch created classes
  const fetchClasses = async () => {
    setLoading(true);
    try {
      const res = await appFetch('/api/classes', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok && data.classes) {
        setClasses(data.classes);
      }
    } catch (err) {
      console.error('Failed to load classes', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  // Submit class creation
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subjectName.trim()) {
      showMsg('Please enter a Subject Name.', 'error');
      return;
    }

    if (isLab && batchTags.length === 0) {
      showMsg('Please add at least one Batch tag for a Lab class.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        academic_year: academicYear,
        branch: academicYear === 'FE' ? 'Common' : branch,
        division,
        subject_name: subjectName.trim(),
        class_type: isLab ? 'Lab/Practical' : 'Lecture',
        batch_names: isLab ? batchTags : []
      };

      const res = await appFetch('/api/classes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        showMsg('Class created successfully!', 'success');
        setSubjectName('');
        setIsLab(false);
        setBatchTags([]);
        fetchClasses();
        if (onClassCreated) onClassCreated();
      } else {
        showMsg(data.error || 'Failed to create class.', 'error');
      }
    } catch (err) {
      showMsg('Network error. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Open Edit Class Modal
  const openEditModal = (cls) => {
    setEditingClass(cls);
    setEditSubjectName(cls.SUBJECT_NAME || cls.subject_name || '');
    const currentBatches = (cls.batches || []).map(b => b.BATCH_NAME || b.batch_name);
    setEditBatches(currentBatches);
    setEditBatchInput('');
  };

  // Submit Class Edit
  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingClass) return;
    if (!editSubjectName.trim()) {
      showMsg('Subject name cannot be empty.', 'error');
      return;
    }

    setSubmittingEdit(true);
    try {
      const classId = editingClass.ID || editingClass.id;
      const res = await appFetch(`/api/classes/${classId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          subject_name: editSubjectName.trim(),
          batch_names: editBatches
        })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('Class updated successfully!', 'success');
        setEditingClass(null);
        fetchClasses();
      } else {
        showMsg(data.error || 'Failed to update class.', 'error');
      }
    } catch (err) {
      showMsg('Network error while updating class.', 'error');
    } finally {
      setSubmittingEdit(false);
    }
  };

  // Delete Class
  const handleDeleteClass = async (cls) => {
    const classId = cls.ID || cls.id;
    const name = cls.SUBJECT_NAME || cls.subject_name;
    if (!window.confirm(`Are you sure you want to delete "${name}"? This will delete all its lab batches, attendance logs, and uploaded files.`)) {
      return;
    }

    setDeletingId(classId);
    try {
      const res = await appFetch(`/api/classes/${classId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const data = await res.json();
      if (res.ok) {
        showMsg(`Class "${name}" deleted.`, 'success');
        fetchClasses();
      } else {
        showMsg(data.error || 'Failed to delete class.', 'error');
      }
    } catch (err) {
      showMsg('Network error deleting class.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
            Course Management
          </span>
          <h2 className="text-2xl font-black text-indigo-900 mt-2">Class Manager</h2>
          <p className="text-xs text-slate-500 mt-1">
            Configure lecture sections, edit subject names, manage lab batches, or remove unused classes.
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400 font-semibold block">Active Classes</span>
          <span className="text-2xl font-black text-indigo-900">{classes.length}</span>
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

      {/* Creation Form Card */}
      <div className="bg-white p-6 sm:p-8 rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100">
        <h3 className="text-lg font-bold text-indigo-900 mb-6 flex items-center gap-2">
          <IconPlus className="w-5 h-5 text-indigo-600" />
          <span>Create New Class or Lab</span>
        </h3>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            
            {/* 1. Academic Year Dropdown */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Academic Year
              </label>
              <select
                value={academicYear}
                onChange={(e) => handleYearChange(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              >
                <option value="FE">First Year (FE)</option>
                <option value="SE">Second Year (SE)</option>
                <option value="TE">Third Year (TE)</option>
                <option value="BE">Final Year (BE)</option>
              </select>
            </div>

            {/* 2. Branch Dropdown */}
            {academicYear !== 'FE' ? (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Branch
                </label>
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                >
                  <option value="CE">Computer Engineering (CE)</option>
                  <option value="IT">Information Technology (IT)</option>
                  <option value="AIDS">AI & Data Science (AIDS)</option>
                  <option value="EXTC">Electronics & Telecom (EXTC)</option>
                  <option value="MECH">Mechanical (MECH)</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Branch (Auto-assigned)
                </label>
                <div className="px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 text-sm font-semibold">
                  Common Curriculum
                </div>
              </div>
            )}

            {/* 3. Division Dropdown */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Division
              </label>
              <select
                value={division}
                onChange={(e) => {
                  setDivision(e.target.value);
                  if (isLab) {
                    setBatchTags([`${e.target.value}1`, `${e.target.value}2`, `${e.target.value}3`]);
                  }
                }}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              >
                {['A', 'B', 'C', 'D', 'E', 'F'].map((div) => (
                  <option key={div} value={div}>
                    Division {div}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Subject Input */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Subject Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Data Structures"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Checkbox: Is this a Lab? */}
          <div className="p-4 bg-indigo-50/40 rounded-xl border border-indigo-100">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isLab}
                onChange={(e) => handleLabToggle(e.target.checked)}
                className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <div>
                <span className="text-sm font-bold text-indigo-900">Is this a Lab session?</span>
                <p className="text-xs text-slate-500">
                  Enable sub-batches (e.g. {division}1, {division}2) for targeted lab materials and attendance roll calls.
                </p>
              </div>
            </label>

            {isLab && (
              <div className="mt-4 pt-4 border-t border-indigo-100">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  Sub-Batches Assigned:
                </label>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {batchTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-100 text-violet-800 rounded-lg text-xs font-bold border border-violet-200"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveBatch(tag)}
                        className="hover:text-red-600 font-black text-sm leading-none"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  {batchTags.length === 0 && (
                    <span className="text-xs text-amber-600 font-medium">
                      No batches added yet. Type a batch name below.
                    </span>
                  )}
                </div>

                <div className="flex gap-2 max-w-sm">
                  <input
                    type="text"
                    value={batchInput}
                    onChange={(e) => setBatchInput(e.target.value.toUpperCase())}
                    placeholder={`e.g. ${division}4`}
                    className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-bold uppercase focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddBatch}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors"
                  >
                    + Add Batch
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-600/25 transition-all text-sm disabled:opacity-50"
          >
            {submitting ? 'Creating Class...' : 'Save & Publish Class'}
          </button>
        </form>
      </div>

      {/* Existing Classes List */}
      <div className="bg-white p-6 sm:p-8 rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100">
        <h3 className="text-lg font-bold text-indigo-900 mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <IconBook className="w-5 h-5 text-indigo-600" />
            <span>Your Active Classes</span>
          </span>
          <button
            onClick={fetchClasses}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            Refresh
          </button>
        </h3>

        {loading ? (
          <p className="text-xs text-slate-400 py-4">Loading your classes...</p>
        ) : classes.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">
            No classes created yet. Fill out the form above to get started!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {classes.map((cls) => {
              const classId = cls.ID || cls.id;
              const year = cls.ACADEMIC_YEAR || cls.academic_year;
              const br = cls.BRANCH || cls.branch;
              const div = cls.DIVISION || cls.division;
              const sub = cls.SUBJECT_NAME || cls.subject_name;
              const type = cls.CLASS_TYPE || cls.class_type;
              const batches = cls.batches || [];
              const isDeleting = deletingId === classId;

              return (
                <div
                  key={classId}
                  className="p-5 rounded-xl border border-indigo-100 hover:border-indigo-300 bg-indigo-50/40 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                          type === 'Lab/Practical'
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-indigo-100 text-indigo-700'
                        }`}
                      >
                        {type}
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-500">
                        {year} &bull; {br} &bull; Div {div}
                      </span>
                    </div>

                    <h4 className="text-base font-extrabold text-indigo-900 mt-2">{sub}</h4>

                    {type === 'Lab/Practical' && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        <span className="text-[10px] text-slate-400 font-semibold mr-1">Batches:</span>
                        {batches.map((b) => (
                          <span
                            key={b.ID || b.id || b.batch_name}
                            className="px-2 py-0.5 bg-white border border-slate-200 text-slate-700 rounded text-[10px] font-bold font-mono"
                          >
                            {b.BATCH_NAME || b.batch_name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions: Edit & Delete */}
                  <div className="mt-4 pt-3 border-t border-indigo-100 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => openEditModal(cls)}
                      className="px-3 py-1 bg-white hover:bg-slate-100 text-indigo-700 font-bold text-xs rounded-lg border border-indigo-200 transition-all shadow-sm"
                    >
                      Edit Class
                    </button>

                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => handleDeleteClass(cls)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200"
                      title="Delete class"
                    >
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Class Modal */}
      {editingClass && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-indigo-100 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-black text-indigo-950">Edit Class</h3>
              <button
                type="button"
                onClick={() => setEditingClass(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Subject Name</label>
                <input
                  type="text"
                  required
                  value={editSubjectName}
                  onChange={(e) => setEditSubjectName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                />
              </div>

              {(editingClass.CLASS_TYPE === 'Lab/Practical' || editingClass.class_type === 'Lab/Practical') && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Lab Batches</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {editBatches.map(b => (
                      <span key={b} className="px-2 py-0.5 bg-violet-100 text-violet-800 text-[11px] font-bold rounded">
                        {b}
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add another batch (e.g. E4)"
                      value={editBatchInput}
                      onChange={(e) => setEditBatchInput(e.target.value.toUpperCase())}
                      className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const tag = editBatchInput.trim().toUpperCase();
                        if (tag && !editBatches.includes(tag)) {
                          setEditBatches([...editBatches, tag]);
                          setEditBatchInput('');
                        }
                      }}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingClass(null)}
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
    </div>
  );
}
