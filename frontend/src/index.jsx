import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import './index.css';
import App from './App';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';

const disabledClerkAuth = {
  enabled: false,
  isLoaded: true,
  isSignedIn: false,
  getToken: async () => '',
  openSignIn: async () => {},
  signOut: async () => {},
  user: null
};

function ClerkAppShell() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();

  return (
    <App
      clerkAuth={{
        enabled: true,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        getToken,
        openSignIn: clerk.openSignIn,
        signOut: clerk.signOut,
        user
      }}
    />
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {clerkPublishableKey ? (
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <ClerkAppShell />
      </ClerkProvider>
    ) : (
      <App clerkAuth={disabledClerkAuth} />
    )}
  </React.StrictMode>
);
