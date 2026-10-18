import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import LandingPage from './components/LandingPage';
import TeacherLogin from './components/TeacherLogin';
import StudentLogin from './components/StudentLogin';
import TeacherDashboard from './components/TeacherDashboard';
import StudentDashboard from './components/StudentDashboard';

// Protected Route Component for Teachers
function ProtectedTeacherRoute({ children }) {
  const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
  const role = localStorage.getItem('studyflow_role');
  if (!token || role !== 'teacher') {
    return <Navigate to="/teacher-login" replace />;
  }
  return children;
}

// Protected Route Component for Students
function ProtectedStudentRoute({ children }) {
  const token = localStorage.getItem('studyflow_jwt') || localStorage.getItem('studyflow_token');
  const role = localStorage.getItem('studyflow_role');
  if (!token || role !== 'student') {
    return <Navigate to="/student-login" replace />;
  }
  return children;
}



export default function App() {
  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/teacher-login" element={<TeacherLogin />} />
        <Route path="/student-login" element={<StudentLogin />} />

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

        {/* Catch-all fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
