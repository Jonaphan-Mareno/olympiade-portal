'use client';

import { useState } from 'react';

export default function ApplicationForm({
  submitAction,
}: {
  submitAction: (formData: FormData) => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    } else {
      setSelectedFile(null);
    }
  };

  return (
    <div>
      <h1
        style={{
          fontSize: '1.75rem',
          fontWeight: 'bold',
          color: '#0F172A',
          marginBottom: '0.5rem',
          textAlign: 'center',
        }}
      >
        Organiser Application
      </h1>
      <p
        style={{
          color: '#64748B',
          textAlign: 'center',
          marginBottom: '2rem',
          fontSize: '0.95rem',
        }}
      >
        To host Olympiads on our platform, please submit your application for
        review.
      </p>

      <form
        action={submitAction}
        style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
      >
        <div
          style={{
            backgroundColor: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '0.5rem',
            padding: '1rem',
          }}
        >
          <h3
            style={{
              fontSize: '0.95rem',
              fontWeight: '600',
              color: '#334155',
              marginBottom: '0.75rem',
            }}
          >
            Application Requirements
          </h3>
          <ul
            style={{
              fontSize: '0.85rem',
              color: '#64748B',
              marginLeft: '1rem',
              listStyleType: 'disc',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.375rem',
            }}
          >
            <li>
              <strong>Your Background:</strong> Brief introduction about
              yourself or your organization.
            </li>
            <li>
              <strong>Previous Experience:</strong> Details of previous
              competitions organized.
            </li>
            <li>
              <strong>Credibility:</strong> Why you are credible to organize
              this Olympiad.
            </li>
            <li>
              <strong>Olympiad Proposal:</strong> Overview of the Olympiad you
              intend to host on our platform.
            </li>
          </ul>
        </div>

        <div>
          <label
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: '500',
              color: '#334155',
              marginBottom: '0.5rem',
            }}
            htmlFor="applicationPdf"
          >
            Application Document (PDF)
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="file"
              name="applicationPdf"
              id="applicationPdf"
              accept="application/pdf"
              required
              onChange={handleFileChange}
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
                zIndex: 10,
              }}
            />
            <div
              style={{
                border: selectedFile
                  ? '2px solid #3B82F6'
                  : '2px dashed #93C5FD',
                borderRadius: '0.5rem',
                padding: '2rem 1rem',
                textAlign: 'center',
                backgroundColor: selectedFile ? '#DBEAFE' : '#EFF6FF',
                transition: 'all 0.2s ease-in-out',
              }}
            >
              {selectedFile ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#2563EB"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ marginBottom: '0.5rem' }}
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <p
                    style={{
                      color: '#1E3A8A',
                      fontWeight: '600',
                      fontSize: '0.9rem',
                    }}
                  >
                    {selectedFile.name}
                  </p>
                  <p
                    style={{
                      color: '#2563EB',
                      fontSize: '0.8rem',
                      marginTop: '0.25rem',
                    }}
                  >
                    Ready to submit
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#3B82F6"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ marginBottom: '0.5rem' }}
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                  <p
                    style={{
                      color: '#2563EB',
                      fontWeight: '500',
                      fontSize: '0.9rem',
                    }}
                  >
                    Click to upload or drag and drop
                  </p>
                  <p
                    style={{
                      color: '#60A5FA',
                      fontSize: '0.8rem',
                      marginTop: '0.25rem',
                    }}
                  >
                    PDF up to 10MB
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          type="submit"
          style={{
            width: '100%',
            backgroundColor: '#0066CC',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '0.5rem',
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            marginTop: '0.5rem',
            transition: 'background-color 0.2s',
          }}
          onMouseOver={(e) =>
            (e.currentTarget.style.backgroundColor = '#004C99')
          }
          onMouseOut={(e) =>
            (e.currentTarget.style.backgroundColor = '#0066CC')
          }
        >
          Submit Application
        </button>
      </form>
    </div>
  );
}
