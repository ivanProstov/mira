import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { BoardPage } from "./pages/BoardPage";

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
      <Route path="/" element={user ? <Navigate to="/app" replace /> : <LoginPage />} />
      <Route path="/app" element={user ? <HomePage /> : <Navigate to="/" replace />} />
      <Route path="/room/:roomId" element={user ? <BoardPage /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to={user ? "/app" : "/"} replace />} />
    </Routes>
  );
}
