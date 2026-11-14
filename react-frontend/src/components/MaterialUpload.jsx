import { appFetch } from '../lib/transport';
import InAppViewer from './InAppViewer';
import { useCallback } from 'react';
import { authFetch as fetch } from '../lib/api';
import React, { useState, useEffect, useRef } from 'react';

import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconFile,
  IconFlask,
  IconUpload,
  IconTrash,
} from './icons';

export default function MaterialUpload() {
  const [preview,setPreview]=useState(null);
  const closePreview=useCallback(()=>setPreview(null),[]);
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [topicTitle, setTopicTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  const [loadingClasses, setLoadingClasses] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [dragActive, setDragActive] = useState(false);

  // Tab: 'upload' or 'manage'
  const [activeTab, setActiveTab] = useState('upload');
  const [myMaterials, setMyMaterials] = useState([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fileInputRef = useRef(null);

  const getToken = () =>
    localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');

  // Fetch teacher's classes
  const fetchClasses = async () => {
    try {
      const res = await appFetch('/api/classes', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok && data.classes) {
        setClasses(data.classes);
        if (data.classes.length > 0) {
          setSelectedClassId(String(data.classes[0].ID || data.classes[0].id));
        }
      }
    } catch (err) {
      console.error('Failed to load classes for upload', err);
    } finally {
      setLoadingClasses(false);
    }
  };

  // Fetch uploaded materials
  const fetchMyMaterials = async () => {
    setLoadingMaterials(true);
    try {
      const res = await appFetch('/api/materials/teacher', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok && data.materials) {
        setMyMaterials(data.materials);
      }
    } catch (err) {
      console.error('Failed to load teacher materials', err);
    } finally {
      setLoadingMaterials(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  useEffect(() => {
    if (activeTab === 'manage') {
      fetchMyMaterials();
    }
  }, [activeTab]);

  const currentClass = classes.find(
    (c) => String(c.ID || c.id) === String(selectedClassId)
  );
  const isCurrentLab =
    currentClass &&
    (currentClass.CLASS_TYPE === 'Lab/Practical' || currentClass.class_type === 'Lab/Practical');
  const availableBatches = currentClass?.batches || [];

  const handleClassChange = (newClassId) => {
    setSelectedClassId(newClassId);
    setSelectedBatchId('');
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setMessage({ text: 'Only PDF documents are allowed.', type: 'error' });
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setMessage({ text: 'File size exceeds 30 MB limit.', type: 'error' });
      return;
    }
    setMessage({ text: '', type: '' });
    setSelectedFile(file);
  };

  // Delete material handler
  const handleDeleteMaterial = async (id, title) => {
    if (!window.confirm(`Are you sure you want to delete "${title}"?`)) return;
    setDeletingId(id);
    try {
      const res = await appFetch(`/api/materials/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: `Material "${title}" removed.`, type: 'success' });
        fetchMyMaterials();
      } else {
        setMessage({ text: data.error || 'Failed to delete material.', type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Network error deleting material.', type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  // Submit as FormData
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });

    if (!selectedClassId) {
      setMessage({ text: 'Please select a class.', type: 'error' });
      return;
    }
    if (!topicTitle.trim()) {
      setMessage({ text: 'Please enter a Topic Title.', type: 'error' });
      return;
    }
    if (!selectedFile) {
      setMessage({ text: 'Please select or drop a PDF file.', type: 'error' });
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('class_id', selectedClassId);
      formData.append('unit_number', unitNumber.trim());
      formData.append('title', topicTitle.trim());
      if (selectedBatchId && selectedBatchId !== 'ALL') {
        formData.append('batch_id', selectedBatchId);
      }
      formData.append('file', selectedFile);

      const res = await appFetch('/api/materials/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({
          text: `Success! "${topicTitle}" has been published to student coursework.`,
          type: 'success',
        });
        setTopicTitle('');
        setUnitNumber('');
        setSelectedFile(null);
        setSelectedBatchId('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setMessage({ text: data.error || 'Failed to upload material.', type: 'error' });
      }
    } catch (err) {
      setMessage({ text: 'Network connection failed during upload.', type: 'error' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {preview&&<InAppViewer file={preview} onClose={closePreview}/>}
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
            Digital Courseware
          </span>
          <h2 className="text-2xl font-black text-indigo-900 mt-2">Study Materials</h2>
          <p className="text-xs text-slate-500 mt-1">
            Publish unit-wise notes and lab manual PDFs, or manage existing uploads.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold self-start md:self-auto">
          <button
            onClick={() => setActiveTab('upload')}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${
              activeTab === 'upload' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-indigo-900'
            }`}
          >
            + Upload PDF
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${
              activeTab === 'manage' ? 'bg-white text-indigo-900 shadow-sm' : 'text-slate-600 hover:text-indigo-900'
            }`}
          >
            Manage Uploads ({myMaterials.length})
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

      {/* TAB 1: Upload Form */}
      {activeTab === 'upload' && (
        <>
          {loadingClasses ? (
            <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center text-slate-400 text-sm">
              Loading your active courses...
            </div>
          ) : classes.length === 0 ? (
            <div className="bg-white p-10 rounded-2xl border border-indigo-200/70 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-400 flex items-center justify-center">
                <IconUpload className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-indigo-900">No Classes Available</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                You need to create at least one lecture or lab class in <strong>Class Manager</strong> before you can upload notes.
              </p>
            </div>
          ) : (
            <div className="bg-white p-6 sm:p-8 rounded-2xl border border-indigo-200/70 shadow-sm shadow-indigo-100">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                      Select Target Class
                    </label>
                    <select
                      value={selectedClassId}
                      onChange={(e) => handleClassChange(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                    >
                      {classes.map((cls) => {
                        const cId = cls.ID || cls.id;
                        const year = cls.ACADEMIC_YEAR || cls.academic_year;
                        const br = cls.BRANCH || cls.branch;
                        const div = cls.DIVISION || cls.division;
                        const sub = cls.SUBJECT_NAME || cls.subject_name;
                        const type = cls.CLASS_TYPE || cls.class_type;

                        return (
                          <option key={cId} value={cId}>
                            {sub} &bull; {year}-{br} (Div {div}) [{type}]
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {isCurrentLab ? (
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-violet-700 mb-1.5 flex items-center gap-1">
                        <IconFlask className="w-3.5 h-3.5" />
                        <span>Target Lab Batch</span>
                      </label>
                      <select
                        value={selectedBatchId}
                        onChange={(e) => setSelectedBatchId(e.target.value)}
                        className="w-full px-4 py-3 bg-violet-50/50 border border-violet-200 rounded-xl text-violet-950 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500 focus:bg-white"
                      >
                        <option value="">All Batches (Whole Division)</option>
                        {availableBatches.map((b) => (
                          <option key={b.ID || b.id} value={b.ID || b.id}>
                            Only Batch {b.BATCH_NAME || b.batch_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        Distribution Scope
                      </label>
                      <div className="px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 text-sm font-medium">
                        Entire Division ({currentClass?.DIVISION || currentClass?.division})
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                      Unit Number
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Unit 3 or Module 2"
                      value={unitNumber}
                      onChange={(e) => setUnitNumber(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                      Topic Title
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Graph Algorithms & Dijkstra"
                      value={topicTitle}
                      onChange={(e) => setTopicTitle(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                    />
                  </div>
                </div>

                {/* PDF Dropzone */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Upload PDF Document
                  </label>

                  <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                      dragActive
                        ? 'border-indigo-600 bg-indigo-50/50 scale-[1.01]'
                        : selectedFile
                        ? 'border-emerald-400 bg-emerald-50/40'
                        : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />

                    {selectedFile ? (
                      <div className="space-y-2">
                        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                          <IconFile className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-bold text-slate-800">{selectedFile.name}</p>
                        <p className="text-xs text-slate-500">
                          {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB &bull; Ready to upload
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="text-xs text-red-600 hover:underline font-bold mt-2 inline-block"
                        >
                          Remove file
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="w-12 h-12 mx-auto rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                          <IconUpload className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-bold text-slate-700">
                          Drag & Drop your course PDF here, or <span className="text-indigo-600 underline">browse</span>
                        </p>
                        <p className="text-xs text-slate-400">Standard PDF documents up to 30MB</p>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={uploading}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <span>Publishing PDF...</span>
                  ) : (
                    <>
                      <span>Upload & Distribute to Students</span>
                      <IconArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </>
      )}

      {/* TAB 2: Manage Existing Uploads */}
      {activeTab === 'manage' && (
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-indigo-200/70 shadow-sm space-y-4">
          <h3 className="text-base font-bold text-indigo-900">Your Uploaded Materials</h3>

          {loadingMaterials ? (
            <div className="text-center py-12 text-slate-400 text-xs">Loading uploaded files...</div>
          ) : myMaterials.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              No files uploaded yet. Switch to "+ Upload PDF" to publish coursework.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {myMaterials.map((m) => {
                const id = m.id ?? m.ID;
                const title = m.title ?? m.TITLE;
                const unit = m.unit_number ?? m.UNIT_NUMBER;
                const sub = m.subject_name ?? m.SUBJECT_NAME;
                const year = m.academic_year ?? m.ACADEMIC_YEAR;
                const div = m.division ?? m.DIVISION;
                const batch = m.target_batch ?? m.TARGET_BATCH;
                const date = m.upload_timestamp ?? m.UPLOAD_TIMESTAMP;
                const fileUrl = m.file_url ?? m.FILE_URL;

                return (
                  <div key={id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 border border-red-100 flex items-center justify-center shrink-0 mt-0.5">
                        <IconFile className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-extrabold uppercase rounded-full">
                            {unit || 'General'}
                          </span>
                          <span className="text-xs font-bold text-slate-600">
                            {sub} ({year} Div {div})
                          </span>
                          {batch && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-mono font-bold rounded">
                              Batch {batch}
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-extrabold text-indigo-950">{title}</h4>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {date && new Date(date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        type="button"
                        onClick={()=>setPreview(m)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === id}
                        onClick={() => handleDeleteMaterial(id, title)}
                        className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors border border-transparent hover:border-red-200"
                        title="Delete material"
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
      )}
    </div>
  );
}
