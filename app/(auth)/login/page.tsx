/**
 * Login Page - Minimum Stub for Plan 0001
 *
 * Detailed styling/design is handled by a separate plan.
 * This page provides:
 * - "Login with Riot" button
 * - Error message display from query params
 * - Fragment parsing for implicit grant callback
 */

"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for error in query params
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error");
    if (errorCode) {
      setError(getErrorMessage(errorCode));
    }

    // Check for access_token in URL fragment (implicit grant callback)
    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      handleFragmentCallback(hash);
    }
  }, []);

  async function handleFragmentCallback(hash: string) {
    try {
      // Parse fragment
      const params = new URLSearchParams(hash.substring(1)); // Remove #
      const state = params.get("state");
      const accessToken = params.get("access_token");

      if (state && accessToken) {
        // Post to hash endpoint
        const response = await fetch("/api/auth/callback/hash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state, access_token: accessToken }),
        });

        const data = await response.json();
        if (data.ok && data.redirect) {
          window.location.replace(data.redirect);
        } else {
          setError("Authentication failed. Please try again.");
        }
      }
    } catch {
      setError("An error occurred during authentication.");
    }
  }

  function handleLoginClick() {
    window.location.href = "/api/auth/start";
  }

  function getErrorMessage(code: string): string {
    switch (code) {
      case "state_mismatch":
        return "Security validation failed. Please try logging in again.";
      case "missing_token":
        return "Authentication token missing. Please try again.";
      case "upstream":
        return "Riot servers are experiencing issues. Please try again later.";
      case "timeout":
        return "Authentication timed out. Please try again.";
      case "invalid_token":
        return "Invalid authentication token. Please try again.";
      default:
        return "An error occurred during login. Please try again.";
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">VALShop</h1>
          <p className="mt-2 text-sm text-gray-600">Valorant Store Viewer</p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <button
            onClick={handleLoginClick}
            className="w-full rounded-md bg-red-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            Login with Riot
          </button>

          <p className="text-center text-xs text-gray-500">
            By logging in, you agree to Riot Games&apos; Terms of Service.
            <br />
            This is a fan-made project and is not affiliated with Riot Games.
          </p>
        </div>
      </div>
    </div>
  );
}
