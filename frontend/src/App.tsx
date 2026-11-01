import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { BoardPage } from "./pages/BoardPage";
import { HomePage } from "./pages/HomePage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";

export function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="splash">
        <span className="mark">M</span>
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={user ? <Navigate to="/app" replace /> : <LoginPage />} />
      <Route path="/app" element={user ? <HomePage /> : <Navigate to="/login" replace />} />
      <Route path="/room/:roomId" element={user ? <BoardPage /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={user ? "/app" : "/"} replace />} />
    </Routes>
  );
}
