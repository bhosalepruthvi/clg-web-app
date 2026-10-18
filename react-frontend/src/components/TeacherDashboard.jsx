import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import ClassManager from './ClassManager';
import AttendanceTaker from './AttendanceTaker';
import MaterialUpload from './MaterialUpload';

export default function TeacherDashboard() {
  const [activeTab, setActiveTab] = useState('classes'); // 'classes' | 'attendance' | 'upload'
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem('studyflow_user') || '{}');

  const handleLogout = () => {
    localStorage.removeItem('studyflow_jwt');
    localStorage.removeItem('studyflow_token');
    localStorage.removeItem('studyflow_role');
    localStorage.removeItem('studyflow_user');
    navigate('/');
  };

  const navItems = [
    {
      id: 'classes',
      label: 'Class Manager',
      icon: '📚',
      description: 'Create classes & lab batches',
    },
    {
      id: 'attendance',
      label: 'Take Attendance',
      icon: '📋',
      description: '60-sec roll call & batch switches',
    },
    {
      id: 'upload',
      label: 'Upload Material',
      icon: '📤',
      description: 'Publish unit notes & lab PDFs',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row font-sans">
      
      {/* Mobile Header */}
      <header className="md:hidden bg-[#1e3a5f] text-white p-4 flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center font-black text-sm">
            SF
          </div>
          <div>
            <h1 className="font-extrabold text-base leading-none">StudyFlow</h1>
            <p className="text-[10px] text-blue-200">Teacher Portal</p>
          </div>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-white hover:bg-white/10 rounded-lg focus:outline-none text-xl"
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-20 h-screen w-72 bg-[#1e3a5f] text-white flex flex-col justify-between p-6 transition-transform duration-300 shadow-xl ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="space-y-8">
          {/* Brand Logo & Title */}
          <div className="flex items-center gap-3 pb-6 border-b border-white/10">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center font-extrabold text-base shadow-lg shadow-blue-500/30">
              SF
            </div>
            <div>
              <h2 className="font-black text-lg tracking-tight leading-none">StudyFlow</h2>
              <span className="text-[11px] text-blue-200 font-medium">Faculty Workspace</span>
            </div>
          </div>

          {/* Sidebar Links */}
          <nav className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-extrabold text-blue-300/70 px-3 mb-2">
              Menu
            </p>

            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl font-bold text-sm text-left transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 translate-x-1'
                      : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="text-xl">{item.icon}</span>
                  <div>
                    <p className="leading-tight">{item.label}</p>
                    <p
                      className={`text-[10px] font-normal ${
                        isActive ? 'text-blue-100' : 'text-blue-300/60'
                      }`}
                    >
                      {item.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Faculty Profile Card & Logout */}
        <div className="pt-6 border-t border-white/10 space-y-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 border border-blue-400/30 flex items-center justify-center font-bold text-blue-300">
              👨‍🏫
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-white truncate">{user.name || 'Faculty Member'}</p>
              <p className="text-[10px] text-blue-200/70 truncate">{user.email || 'faculty@college.edu'}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full py-2.5 px-4 rounded-xl bg-red-600/20 hover:bg-red-600 text-red-200 hover:text-white text-xs font-bold transition-all border border-red-500/30 flex items-center justify-center gap-2"
          >
            <span>Sign Out</span>
            <span>&rarr;</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-h-screen p-4 sm:p-8 lg:p-10 overflow-y-auto">
        {/* Dynamic View rendering based on active tab */}
        {activeTab === 'classes' && <ClassManager />}
        {activeTab === 'attendance' && <AttendanceTaker />}
        {activeTab === 'upload' && <MaterialUpload />}
      </main>
    </div>
  );
}
