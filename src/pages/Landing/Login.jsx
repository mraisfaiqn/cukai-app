import LoginPanel from '../../components/Login/LoginPanel';
import BrandingPanel from '../../components/Login/BrandingPanel';

export default function Login() {
  return (
    <div className="flex w-screen h-screen overflow-hidden">
      <LoginPanel />
      <BrandingPanel />
    </div>
  );
}