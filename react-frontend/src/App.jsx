import React, { lazy, Suspense } from 'react';
import AppStatus from './components/AppStatus';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

const LandingPage = lazy(() => import('./components/LandingPage'));
const TeacherLogin = lazy(() => import('./components/TeacherLogin'));
const StudentLogin = lazy(() => import('./components/StudentLogin'));
const TeacherDashboard = lazy(() => import('./components/TeacherDashboard'));
const StudentDashboard = lazy(() => import('./components/StudentDashboard'));

// Helper to validate JWT expiration if present
const isTokenValid = (token) => {
  if (!token || typeof token !== 'string') return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
};

// Helper to check authentication & role from localStorage
const getAuthUser = () => {
  const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
  const role = localStorage.getItem('studyflow_role');
  if (!token || !isTokenValid(token)) {
    if (token) {
      localStorage.removeItem('studyflow_jwt');
      localStorage.removeItem('studyflow_token');
      localStorage.removeItem('studyflow_role');
      localStorage.removeItem('studyflow_user');
      localStorage.removeItem('studyflow_student');
    }
    return { token: null, role: null };
  }
  return { token, role };
};

// Auto-redirect if already logged in when visiting root "/"
function LandingRoute() {
  const { token, role } = getAuthUser();
  if (token && role === 'teacher') {
    return <Navigate to="/teacher-dashboard" replace />;
  }
  if (token && role === 'student') {
    return <Navigate to="/student-dashboard" replace />;
  }
  return <LandingPage />;
}

// Route Guard for Teacher Login: if already authenticated, take them directly to dashboard
function PublicTeacherRoute({ children }) {
  const { token, role } = getAuthUser();
  if (token && role === 'teacher') {
    return <Navigate to="/teacher-dashboard" replace />;
  }
  return children;
}

// Route Guard for Student Login: if already authenticated, take them directly to dashboard
function PublicStudentRoute({ children }) {
  const { token, role } = getAuthUser();
  if (token && role === 'student') {
    return <Navigate to="/student-dashboard" replace />;
  }
  return children;
}

// Protected Route Guard for Teachers
function ProtectedTeacherRoute({ children }) {
  const { token, role } = getAuthUser();
  if (!token || role !== 'teacher') {
    return <Navigate to="/teacher-login" replace />;
  }
  return children;
}

// Protected Route Guard for Students
function ProtectedStudentRoute({ children }) {
  const { token, role } = getAuthUser();
  if (!token || role !== 'student') {
    return <Navigate to="/student-login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Router><AppStatus /><Suspense fallback={<div className="app-loading" role="status">Opening StudyFlow…</div>}>
      <Routes>
        {/* Public Routes with Session Restoration */}
        <Route path="/" element={<LandingRoute />} />
        <Route path="/teacher-login" element={<PublicTeacherRoute><TeacherLogin /></PublicTeacherRoute>} />
        <Route path="/student-login" element={<PublicStudentRoute><StudentLogin /></PublicStudentRoute>} />

        {/* Protected Teacher Dashboard */}
        <Route
          path="/teacher-dashboard"
          element={
            <ProtectedTeacherRoute>
              <TeacherDashboard />
            </ProtectedTeacherRoute>
          }
        />

        {/* Protected Student Dashboard */}
        <Route
          path="/student-dashboard"
          element={
            <ProtectedStudentRoute>
              <StudentDashboard />
            </ProtectedStudentRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense></Router>
  );
}
