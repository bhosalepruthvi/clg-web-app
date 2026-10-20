import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import ClassManager from './ClassManager';
import AttendanceTaker from './AttendanceTaker';
import MaterialUpload from './MaterialUpload';
import NoticeBoard from './NoticeBoard';
import {
  LogoMark,
  IconLayers,
  IconClipboard,
  IconUpload,
  IconMegaphone,
  IconMenu,
  IconX,
  IconLogout,
} from './icons';

export default function TeacherDashboard() {
  const [activeTab, setActiveTab] = useState('classes'); // 'classes' | 'attendance' | 'upload' | 'notices'
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem('studyflow_user') || '{}');
  const initial = (user.name || 'F').charAt(0).toUpperCase();

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
      icon: IconLayers,
      description: 'Create classes & lab batches',
    },
    {
      id: 'attendance',
      label: 'Take Attendance',
      icon: IconClipboard,
      description: '60-sec roll call & batch switches',
    },
    {
      id: 'upload',
      label: 'Upload Material',
      icon: IconUpload,
      description: 'Publish unit notes & lab PDFs',
    },
    {
      id: 'notices',
      label: 'Notices',
      icon: IconMegaphone,
      description: 'Announcements for your classes',
    },
  ];

  return (
    <div className="min-h-screen bg-indigo-50 flex flex-col md:flex-row">

      {/* Mobile Header */}
      <header className="md:hidden bg-gradient-to-r from-indigo-600 to-violet-600 text-white p-4 flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/15 border border-white/20 flex items-center justify-center">
            <LogoMark className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-extrabold text-base leading-none">StudyFlow</h1>
            <p className="text-[10px] text-indigo-100">Teacher Portal</p>
          </div>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          className="p-2 text-white hover:bg-white/10 rounded-lg focus:outline-none"
        >
          {mobileMenuOpen ? <IconX className="w-5 h-5" /> : <IconMenu className="w-5 h-5" />}
        </button>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-20 h-screen w-72 bg-white text-indigo-900 flex flex-col justify-between p-6 transition-transform duration-300 border-r border-indigo-100 shadow-xl md:shadow-none ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="space-y-8">
          {/* Brand Logo & Title */}
          <div className="flex items-center gap-3 pb-6 border-b border-indigo-100">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-600/25">
              <LogoMark className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-black text-lg tracking-tight leading-none text-indigo-900">StudyFlow</h2>
              <span className="text-[11px] text-slate-500 font-medium">Faculty Workspace</span>
            </div>
          </div>

          {/* Sidebar Links */}
          <nav className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest font-extrabold text-indigo-300 px-3 mb-2">
              Menu
            </p>

            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              const ItemIcon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl font-bold text-sm text-left transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/25 translate-x-1'
                      : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'
                  }`}
                >
                  <ItemIcon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-indigo-400'}`} />
                  <div>
                    <p className="leading-tight">{item.label}</p>
                    <p
                      className={`text-[10px] font-normal ${
                        isActive ? 'text-indigo-100' : 'text-slate-400'
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
        <div className="pt-6 border-t border-indigo-100 space-y-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-full bg-indigo-100 border border-indigo-200 flex items-center justify-center font-black text-indigo-700">
              {initial}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-indigo-900 truncate">{user.name || 'Faculty Member'}</p>
              <p className="text-[10px] text-slate-500 truncate">{user.email || 'faculty@college.edu'}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full py-2.5 px-4 rounded-xl bg-red-50 hover:bg-red-600 text-red-600 hover:text-white text-xs font-bold transition-all border border-red-200 hover:border-red-600 flex items-center justify-center gap-2"
          >
            <IconLogout className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-h-screen p-4 sm:p-8 lg:p-10 overflow-y-auto">
        {/* Dynamic View rendering based on active tab */}
        {activeTab === 'classes' && <ClassManager />}
        {activeTab === 'attendance' && <AttendanceTaker />}
        {activeTab === 'upload' && <MaterialUpload />}
        {activeTab === 'notices' && <NoticeBoard />}
      </main>
    </div>
  );
}
