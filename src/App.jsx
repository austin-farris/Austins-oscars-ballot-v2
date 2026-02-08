import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Best Picture nominees with current odds (as of late January 2026)
const NOMINEES = [
  { id: 1, title: "One Battle After Another", director: "Paul Thomas Anderson", odds: 0.81, poster: "🎬" },
  { id: 2, title: "Hamnet", director: "Chloé Zhao", odds: 0.08, poster: "🎭" },
  { id: 3, title: "Sinners", director: "Ryan Coogler", odds: 0.04, poster: "😈" },
  { id: 4, title: "Marty Supreme", director: "Josh Safdie", odds: 0.03, poster: "🏓" },
  { id: 5, title: "Sentimental Value", director: "Joachim Trier", odds: 0.015, poster: "💝" },
  { id: 6, title: "The Secret Agent", director: "Kleber Mendonça Filho", odds: 0.01, poster: "🕵️" },
  { id: 7, title: "Frankenstein", director: "Guillermo del Toro", odds: 0.005, poster: "🧟" },
  { id: 8, title: "Bugonia", director: "Yorgos Lanthimos", odds: 0.005, poster: "🐝" },
  { id: 9, title: "F1", director: "Joseph Kosinski", odds: 0.003, poster: "🏎️" },
  { id: 10, title: "Train Dreams", director: "Clint Bentley", odds: 0.002, poster: "🚂" },
];

// Calculate points for a correct pick
const calculatePoints = (odds) => Math.round(100 * (1 - odds));

// CHANGE THIS PASSWORD to something only you know!
const ADMIN_PASSWORD = "oscar2026";

export default function App() {
  const [nominees, setNominees] = useState(NOMINEES);
  const [players, setPlayers] = useState([]);
  const [settings, setSettings] = useState({ winner: null, odds_locked: false });
  const [newPlayerName, setNewPlayerName] = useState('');
  const [selectedPick, setSelectedPick] = useState(null);
  const [view, setView] = useState('submit');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingOdds, setEditingOdds] = useState({});
  
  // Admin authentication
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  
  // Check if admin was previously unlocked in this browser
  useEffect(() => {
    const savedAdmin = localStorage.getItem('oscars_admin_unlocked');
    if (savedAdmin === 'true') {
      setAdminUnlocked(true);
    }
  }, []);
  
  // Handle admin login
  const handleAdminLogin = () => {
    if (passwordInput === ADMIN_PASSWORD) {
      setAdminUnlocked(true);
      setPasswordError(false);
      localStorage.setItem('oscars_admin_unlocked', 'true');
    } else {
      setPasswordError(true);
    }
  };
  
  // Handle admin logout
  const handleAdminLogout = () => {
    setAdminUnlocked(false);
    localStorage.removeItem('oscars_admin_unlocked');
    setView('leaderboard');
  };

  // Sort nominees by odds (favorites first)
  const sortedNominees = [...nominees].sort((a, b) => b.odds - a.odds);

  // Load initial data
  useEffect(() => {
    loadData();
    
    // Set up real-time subscriptions
    const playersSubscription = supabase
      .channel('players-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
        loadPlayers();
      })
      .subscribe();

    const settingsSubscription = supabase
      .channel('settings-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => {
        loadSettings();
      })
      .subscribe();

    const oddsSubscription = supabase
      .channel('odds-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'odds' }, () => {
        loadOdds();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(playersSubscription);
      supabase.removeChannel(settingsSubscription);
      supabase.removeChannel(oddsSubscription);
    };
  }, []);

  async function loadData() {
    setLoading(true);
    await Promise.all([loadPlayers(), loadSettings(), loadOdds()]);
    setLoading(false);
  }

  async function loadPlayers() {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('created_at', { ascending: true });
    
    if (!error && data) {
      setPlayers(data);
    }
  }

  async function loadSettings() {
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('id', 1)
      .single();
    
    if (!error && data) {
      setSettings(data);
    }
  }

  async function loadOdds() {
    const { data, error } = await supabase
      .from('odds')
      .select('*');
    
    if (!error && data && data.length > 0) {
      setNominees(NOMINEES.map(nom => {
        const dbOdds = data.find(o => o.nominee_id === nom.id);
        return dbOdds ? { ...nom, odds: dbOdds.odds } : nom;
      }));
    }
  }

  // Calculate leaderboard
  const leaderboard = players
    .map(player => {
      const nominee = nominees.find(n => n.id === player.pick_id);
      return {
        ...player,
        points: settings.winner && player.pick_id === settings.winner 
          ? calculatePoints(nominee?.odds || 0) 
          : 0,
        correct: settings.winner && player.pick_id === settings.winner,
        pickTitle: nominee?.title || 'Unknown',
      };
    })
    .sort((a, b) => b.points - a.points || a.created_at.localeCompare(b.created_at));

  // Submit a pick
  async function submitPick() {
    if (!newPlayerName.trim() || !selectedPick) return;
    
    const existingPlayer = players.find(
      p => p.name.toLowerCase() === newPlayerName.toLowerCase()
    );
    if (existingPlayer) {
      alert('Someone with that name already submitted a pick!');
      return;
    }

    setSubmitting(true);
    
    const { error } = await supabase
      .from('players')
      .insert([{ name: newPlayerName.trim(), pick_id: selectedPick }]);
    
    if (error) {
      alert('Error submitting pick. Please try again.');
      console.error(error);
    } else {
      setNewPlayerName('');
      setSelectedPick(null);
      setView('leaderboard');
    }
    
    setSubmitting(false);
  }

  // Admin: Announce winner
  async function announceWinner(nomineeId) {
    const { error } = await supabase
      .from('settings')
      .update({ winner: nomineeId })
      .eq('id', 1);
    
    if (error) {
      alert('Error updating winner');
      console.error(error);
    }
  }

  // Admin: Reset winner
  async function resetWinner() {
    const { error } = await supabase
      .from('settings')
      .update({ winner: null })
      .eq('id', 1);
    
    if (error) console.error(error);
  }

  // Admin: Update odds
  async function updateOdds(nomineeId, newOdds) {
    const parsed = parseFloat(newOdds);
    if (isNaN(parsed) || parsed < 0 || parsed > 1) return;
    
    const { error } = await supabase
      .from('odds')
      .upsert({ nominee_id: nomineeId, odds: parsed }, { onConflict: 'nominee_id' });
    
    if (error) console.error(error);
  }

  // Admin: Remove player
  async function removePlayer(playerId) {
    const { error } = await supabase
      .from('players')
      .delete()
      .eq('id', playerId);
    
    if (error) console.error(error);
  }

  // Admin: Reset all
  async function resetAll() {
    if (!confirm('Delete all players and reset winner? This cannot be undone.')) return;
    
    await supabase.from('players').delete().neq('id', 0);
    await supabase.from('settings').update({ winner: null }).eq('id', 1);
  }

  const getPickedFilm = (pickId) => nominees.find(n => n.id === pickId);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ffd700',
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: '1.5rem',
      }}>
        Loading... 🏆
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%)',
      fontFamily: "'Playfair Display', Georgia, serif",
      color: '#f5f5f5',
      padding: '0',
      margin: '0',
    }}>
      {/* Header */}
      <header style={{
        background: 'linear-gradient(90deg, #b8860b 0%, #ffd700 50%, #b8860b 100%)',
        padding: '24px',
        textAlign: 'center',
        borderBottom: '4px solid #ffd700',
        boxShadow: '0 4px 30px rgba(255, 215, 0, 0.3)',
      }}>
        <h1 style={{
          fontSize: '2.2rem',
          fontWeight: '700',
          color: '#0a0a0a',
          margin: '0',
          textTransform: 'uppercase',
          letterSpacing: '4px',
          textShadow: '2px 2px 4px rgba(255,255,255,0.3)',
        }}>
          🏆 Austin's Oscars Ballot 🏆
        </h1>
        <p style={{
          margin: '8px 0 0',
          color: '#1a1a2e',
          fontSize: '1rem',
          letterSpacing: '3px',
          fontFamily: "'Helvetica Neue', sans-serif",
        }}>
          98th Academy Awards · March 15, 2026
        </p>
      </header>

      {/* Navigation */}
      <nav style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '8px',
        padding: '16px',
        background: 'rgba(0,0,0,0.4)',
        borderBottom: '1px solid rgba(255,215,0,0.2)',
        flexWrap: 'wrap',
      }}>
        {[
          { id: 'submit', label: '📝 Submit Pick' },
          { id: 'leaderboard', label: '📊 Leaderboard' },
          { id: 'admin', label: adminUnlocked ? '⚙️ Admin' : '🔐 Admin' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={{
              padding: '12px 24px',
              background: view === tab.id 
                ? 'linear-gradient(135deg, #ffd700, #b8860b)' 
                : 'transparent',
              border: view === tab.id 
                ? 'none' 
                : '1px solid rgba(255,215,0,0.4)',
              borderRadius: '8px',
              color: view === tab.id ? '#0a0a0a' : '#ffd700',
              cursor: 'pointer',
              fontFamily: "'Helvetica Neue', sans-serif",
              fontSize: '0.9rem',
              fontWeight: view === tab.id ? '700' : '400',
              transition: 'all 0.3s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 16px' }}>
        
        {/* SUBMIT PICK VIEW */}
        {view === 'submit' && (
          <div>
            {settings.winner ? (
              <div style={{
                textAlign: 'center',
                padding: '40px',
                background: 'rgba(255,215,0,0.1)',
                borderRadius: '16px',
                border: '2px solid #ffd700',
              }}>
                <h2 style={{ color: '#ffd700', fontSize: '2rem' }}>🎬 Picks Are Closed 🎬</h2>
                <p style={{ fontSize: '1.2rem', opacity: 0.8 }}>
                  The winner has been announced! Check the leaderboard.
                </p>
              </div>
            ) : (
              <>
                <div style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '16px',
                  padding: '24px',
                  marginBottom: '24px',
                  border: '1px solid rgba(255,215,0,0.2)',
                }}>
                  <h2 style={{ 
                    color: '#ffd700', 
                    marginTop: 0,
                    fontSize: '1.5rem',
                    borderBottom: '1px solid rgba(255,215,0,0.3)',
                    paddingBottom: '12px',
                  }}>
                    Best Picture Nominees
                  </h2>
                  <p style={{ 
                    fontFamily: "'Helvetica Neue', sans-serif", 
                    fontSize: '0.9rem',
                    opacity: 0.7,
                    marginBottom: '20px',
                  }}>
                    Points shown = what you'll earn if correct. Riskier picks = more points!
                  </p>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {sortedNominees.map((nominee) => (
                      <button
                        key={nominee.id}
                        onClick={() => setSelectedPick(nominee.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '16px 20px',
                          background: selectedPick === nominee.id 
                            ? 'linear-gradient(135deg, rgba(255,215,0,0.3), rgba(184,134,11,0.3))'
                            : 'rgba(255,255,255,0.03)',
                          border: selectedPick === nominee.id 
                            ? '2px solid #ffd700' 
                            : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <span style={{ fontSize: '2rem' }}>{nominee.poster}</span>
                          <div>
                            <div style={{ 
                              color: '#f5f5f5', 
                              fontWeight: '600',
                              fontSize: '1.1rem',
                            }}>
                              {nominee.title}
                            </div>
                            <div style={{ 
                              color: 'rgba(255,255,255,0.5)', 
                              fontSize: '0.85rem',
                              fontFamily: "'Helvetica Neue', sans-serif",
                            }}>
                              {nominee.director}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{
                            color: '#ffd700',
                            fontWeight: '700',
                            fontSize: '1.3rem',
                            fontFamily: "'Helvetica Neue', sans-serif",
                          }}>
                            {calculatePoints(nominee.odds)} pts
                          </div>
                          <div style={{
                            color: 'rgba(255,255,255,0.4)',
                            fontSize: '0.75rem',
                            fontFamily: "'Helvetica Neue', sans-serif",
                          }}>
                            {(nominee.odds * 100).toFixed(1)}% odds
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Submit Form */}
                <div style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '16px',
                  padding: '24px',
                  border: '1px solid rgba(255,215,0,0.2)',
                }}>
                  <h3 style={{ color: '#ffd700', marginTop: 0 }}>Lock In Your Pick</h3>
                  
                  {selectedPick && (
                    <div style={{
                      background: 'rgba(255,215,0,0.1)',
                      padding: '16px',
                      borderRadius: '8px',
                      marginBottom: '16px',
                      border: '1px solid rgba(255,215,0,0.3)',
                    }}>
                      <strong>Your selection:</strong> {getPickedFilm(selectedPick)?.title}
                      <br />
                      <span style={{ color: '#ffd700' }}>
                        Worth {calculatePoints(getPickedFilm(selectedPick)?.odds || 0)} points if correct
                      </span>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={newPlayerName}
                      onChange={(e) => setNewPlayerName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitPick()}
                      style={{
                        flex: '1',
                        minWidth: '200px',
                        padding: '14px 18px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,215,0,0.4)',
                        background: 'rgba(0,0,0,0.3)',
                        color: '#f5f5f5',
                        fontSize: '1rem',
                        fontFamily: "'Helvetica Neue', sans-serif",
                      }}
                    />
                    <button
                      onClick={submitPick}
                      disabled={!newPlayerName.trim() || !selectedPick || submitting}
                      style={{
                        padding: '14px 32px',
                        background: (!newPlayerName.trim() || !selectedPick || submitting)
                          ? 'rgba(255,255,255,0.1)'
                          : 'linear-gradient(135deg, #ffd700, #b8860b)',
                        border: 'none',
                        borderRadius: '8px',
                        color: (!newPlayerName.trim() || !selectedPick || submitting) ? 'rgba(255,255,255,0.3)' : '#0a0a0a',
                        cursor: (!newPlayerName.trim() || !selectedPick || submitting) ? 'not-allowed' : 'pointer',
                        fontWeight: '700',
                        fontSize: '1rem',
                        fontFamily: "'Helvetica Neue', sans-serif",
                      }}
                    >
                      {submitting ? 'Submitting...' : 'Submit Pick'}
                    </button>
                  </div>
                </div>

                {/* Current Submissions Count */}
                {players.length > 0 && (
                  <div style={{
                    marginTop: '24px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '16px',
                    padding: '20px',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}>
                    <h4 style={{ color: '#ffd700', marginTop: 0 }}>
                      {players.length} pick{players.length !== 1 ? 's' : ''} submitted
                    </h4>
                    <div style={{ 
                      display: 'flex', 
                      flexWrap: 'wrap', 
                      gap: '8px',
                      fontFamily: "'Helvetica Neue', sans-serif",
                      fontSize: '0.9rem',
                    }}>
                      {players.map(p => (
                        <span key={p.id} style={{
                          background: 'rgba(255,215,0,0.1)',
                          padding: '6px 12px',
                          borderRadius: '20px',
                          border: '1px solid rgba(255,215,0,0.3)',
                        }}>
                          {p.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* LEADERBOARD VIEW */}
        {view === 'leaderboard' && (
          <div>
            {settings.winner && (
              <div style={{
                textAlign: 'center',
                padding: '32px',
                marginBottom: '24px',
                background: 'linear-gradient(135deg, rgba(255,215,0,0.2), rgba(184,134,11,0.2))',
                borderRadius: '16px',
                border: '2px solid #ffd700',
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🏆</div>
                <h2 style={{ color: '#ffd700', margin: '0 0 8px' }}>Best Picture Winner</h2>
                <div style={{ fontSize: '1.8rem', fontWeight: '700' }}>
                  {getPickedFilm(settings.winner)?.title}
                </div>
                <div style={{ 
                  opacity: 0.7, 
                  fontFamily: "'Helvetica Neue', sans-serif",
                  marginTop: '4px',
                }}>
                  Directed by {getPickedFilm(settings.winner)?.director}
                </div>
              </div>
            )}

            <div style={{
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '16px',
              padding: '24px',
              border: '1px solid rgba(255,215,0,0.2)',
            }}>
              <h2 style={{ 
                color: '#ffd700', 
                marginTop: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}>
                📊 Leaderboard
                {!settings.winner && (
                  <span style={{
                    fontSize: '0.8rem',
                    fontWeight: '400',
                    opacity: 0.6,
                    fontFamily: "'Helvetica Neue', sans-serif",
                  }}>
                    (Points update when winner announced)
                  </span>
                )}
              </h2>

              {players.length === 0 ? (
                <p style={{ 
                  textAlign: 'center', 
                  opacity: 0.5,
                  fontFamily: "'Helvetica Neue', sans-serif",
                }}>
                  No picks submitted yet
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {leaderboard.map((player, index) => (
                    <div
                      key={player.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px 20px',
                        background: player.correct 
                          ? 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(22,163,74,0.2))'
                          : settings.winner && !player.correct
                            ? 'rgba(239,68,68,0.1)'
                            : 'rgba(255,255,255,0.03)',
                        border: player.correct 
                          ? '2px solid #22c55e'
                          : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '50%',
                          background: index === 0 && player.points > 0
                            ? 'linear-gradient(135deg, #ffd700, #b8860b)'
                            : index === 1 && player.points > 0
                              ? 'linear-gradient(135deg, #c0c0c0, #a0a0a0)'
                              : index === 2 && player.points > 0
                                ? 'linear-gradient(135deg, #cd7f32, #8b4513)'
                                : 'rgba(255,255,255,0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: '700',
                          color: index < 3 && player.points > 0 ? '#0a0a0a' : '#f5f5f5',
                          fontFamily: "'Helvetica Neue', sans-serif",
                          flexShrink: 0,
                        }}>
                          {index + 1}
                        </div>
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '1.1rem' }}>
                            {player.name}
                            {player.correct && <span style={{ marginLeft: '8px' }}>✓</span>}
                          </div>
                          <div style={{ 
                            color: 'rgba(255,255,255,0.5)', 
                            fontSize: '0.85rem',
                            fontFamily: "'Helvetica Neue', sans-serif",
                          }}>
                            Picked: {player.pickTitle}
                          </div>
                        </div>
                      </div>
                      <div style={{
                        fontSize: '1.5rem',
                        fontWeight: '700',
                        color: player.points > 0 ? '#22c55e' : 'rgba(255,255,255,0.3)',
                        fontFamily: "'Helvetica Neue', sans-serif",
                      }}>
                        {player.points} pts
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pick Distribution */}
            {players.length > 0 && (
              <div style={{
                marginTop: '24px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '16px',
                padding: '20px',
                border: '1px solid rgba(255,255,255,0.1)',
              }}>
                <h4 style={{ color: '#ffd700', marginTop: 0 }}>Pick Distribution</h4>
                {sortedNominees.map(nominee => {
                  const count = players.filter(p => p.pick_id === nominee.id).length;
                  const pct = (count / players.length) * 100;
                  if (count === 0) return null;
                  return (
                    <div key={nominee.id} style={{ marginBottom: '12px' }}>
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between',
                        marginBottom: '4px',
                        fontFamily: "'Helvetica Neue', sans-serif",
                        fontSize: '0.9rem',
                      }}>
                        <span>{nominee.title}</span>
                        <span>{count} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div style={{
                        height: '8px',
                        background: 'rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: settings.winner === nominee.id 
                            ? '#22c55e' 
                            : 'linear-gradient(90deg, #ffd700, #b8860b)',
                          borderRadius: '4px',
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ADMIN VIEW */}
        {view === 'admin' && (
          <div>
            {!adminUnlocked ? (
              /* Password Gate */
              <div style={{
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '16px',
                padding: '40px',
                border: '1px solid rgba(255,215,0,0.2)',
                textAlign: 'center',
                maxWidth: '400px',
                margin: '0 auto',
              }}>
                <h2 style={{ color: '#ffd700', marginTop: 0 }}>🔐 Admin Access</h2>
                <p style={{ 
                  fontFamily: "'Helvetica Neue', sans-serif", 
                  fontSize: '0.9rem',
                  opacity: 0.7,
                  marginBottom: '24px',
                }}>
                  Enter the admin password to continue
                </p>
                
                <input
                  type="password"
                  placeholder="Password"
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setPasswordError(false);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                  style={{
                    width: '100%',
                    padding: '14px 18px',
                    borderRadius: '8px',
                    border: passwordError 
                      ? '2px solid #ef4444' 
                      : '1px solid rgba(255,215,0,0.4)',
                    background: 'rgba(0,0,0,0.3)',
                    color: '#f5f5f5',
                    fontSize: '1rem',
                    fontFamily: "'Helvetica Neue', sans-serif",
                    marginBottom: '12px',
                  }}
                />
                
                {passwordError && (
                  <p style={{ 
                    color: '#ef4444', 
                    fontSize: '0.85rem',
                    fontFamily: "'Helvetica Neue', sans-serif",
                    marginBottom: '12px',
                  }}>
                    Incorrect password
                  </p>
                )}
                
                <button
                  onClick={handleAdminLogin}
                  style={{
                    width: '100%',
                    padding: '14px 32px',
                    background: 'linear-gradient(135deg, #ffd700, #b8860b)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#0a0a0a',
                    cursor: 'pointer',
                    fontWeight: '700',
                    fontSize: '1rem',
                    fontFamily: "'Helvetica Neue', sans-serif",
                  }}
                >
                  Unlock Admin
                </button>
              </div>
            ) : (
            /* Admin Content */
            <>
            <div style={{
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '16px',
              padding: '24px',
              marginBottom: '24px',
              border: '1px solid rgba(255,215,0,0.2)',
            }}>
              <h2 style={{ color: '#ffd700', marginTop: 0 }}>🎬 Announce Winner</h2>
              <p style={{ 
                fontFamily: "'Helvetica Neue', sans-serif", 
                fontSize: '0.9rem',
                opacity: 0.7,
              }}>
                Click a film when it wins — leaderboard updates instantly for everyone!
              </p>
              
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: '12px',
                marginTop: '16px',
              }}>
                {sortedNominees.map(nominee => (
                  <button
                    key={nominee.id}
                    onClick={() => announceWinner(nominee.id)}
                    style={{
                      padding: '16px',
                      background: settings.winner === nominee.id 
                        ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                        : 'rgba(255,255,255,0.05)',
                      border: settings.winner === nominee.id 
                        ? '2px solid #22c55e'
                        : '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: '#f5f5f5',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '1.5rem' }}>{nominee.poster}</span>
                      <div>
                        <div style={{ fontWeight: '600' }}>{nominee.title}</div>
                        <div style={{ 
                          fontSize: '0.8rem', 
                          opacity: 0.6,
                          fontFamily: "'Helvetica Neue', sans-serif",
                        }}>
                          {calculatePoints(nominee.odds)} pts if picked
                        </div>
                      </div>
                    </div>
                    {settings.winner === nominee.id && (
                      <div style={{
                        marginTop: '8px',
                        fontSize: '0.85rem',
                        color: '#fff',
                        fontFamily: "'Helvetica Neue', sans-serif",
                      }}>
                        ✓ WINNER
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {settings.winner && (
                <button
                  onClick={resetWinner}
                  style={{
                    marginTop: '16px',
                    padding: '12px 24px',
                    background: 'rgba(239,68,68,0.2)',
                    border: '1px solid #ef4444',
                    borderRadius: '8px',
                    color: '#ef4444',
                    cursor: 'pointer',
                    fontFamily: "'Helvetica Neue', sans-serif",
                  }}
                >
                  Reset Winner
                </button>
              )}
            </div>

            {/* Update Odds */}
            <div style={{
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '16px',
              padding: '24px',
              marginBottom: '24px',
              border: '1px solid rgba(255,215,0,0.2)',
            }}>
              <h2 style={{ color: '#ffd700', marginTop: 0 }}>📈 Update Odds</h2>
              
              {/* Auto-fetch from Polymarket */}
              <div style={{
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '20px',
              }}>
                <p style={{ 
                  fontFamily: "'Helvetica Neue', sans-serif", 
                  fontSize: '0.9rem',
                  margin: '0 0 12px 0',
                }}>
                  🔄 <strong>Auto-sync with Polymarket</strong> — Odds update automatically every 2 hours, or click below to update now.
                </p>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/update-odds');
                      const data = await res.json();
                      if (data.success) {
                        alert(`✓ Updated ${data.odds?.length || 0} odds from Polymarket!`);
                        loadOdds(); // Refresh the odds display
                      } else {
                        alert('Error: ' + (data.error || 'Unknown error'));
                      }
                    } catch (err) {
                      alert('Failed to fetch odds: ' + err.message);
                    }
                  }}
                  style={{
                    padding: '10px 20px',
                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '0.9rem',
                    fontFamily: "'Helvetica Neue', sans-serif",
                  }}
                >
                  🔄 Fetch Live Odds from Polymarket
                </button>
              </div>

              <p style={{ 
                fontFamily: "'Helvetica Neue', sans-serif", 
                fontSize: '0.9rem',
                opacity: 0.7,
              }}>
                Or manually update odds below (enter as decimal: 0.81 = 81%)
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
                {sortedNominees.map(nominee => (
                  <div 
                    key={nominee.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: 'rgba(255,255,255,0.03)',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.1)',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <span style={{ minWidth: '150px' }}>{nominee.title}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        value={editingOdds[nominee.id] ?? nominee.odds}
                        onChange={(e) => setEditingOdds({
                          ...editingOdds,
                          [nominee.id]: e.target.value
                        })}
                        onBlur={() => {
                          if (editingOdds[nominee.id] !== undefined) {
                            updateOdds(nominee.id, editingOdds[nominee.id]);
                          }
                        }}
                        style={{
                          width: '80px',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(255,215,0,0.4)',
                          background: 'rgba(0,0,0,0.3)',
                          color: '#f5f5f5',
                          textAlign: 'center',
                          fontFamily: "'Helvetica Neue', sans-serif",
                        }}
                      />
                      <span style={{ 
                        color: '#ffd700',
                        fontFamily: "'Helvetica Neue', sans-serif",
                        width: '60px',
                      }}>
                        = {calculatePoints(nominee.odds)} pts
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Manage Players */}
            <div style={{
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '16px',
              padding: '24px',
              border: '1px solid rgba(255,215,0,0.2)',
            }}>
              <h2 style={{ color: '#ffd700', marginTop: 0 }}>👥 Manage Players</h2>
              
              {players.length === 0 ? (
                <p style={{ opacity: 0.5, fontFamily: "'Helvetica Neue', sans-serif" }}>
                  No players yet
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {players.map(player => (
                    <div
                      key={player.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        flexWrap: 'wrap',
                        gap: '8px',
                      }}
                    >
                      <div>
                        <strong>{player.name}</strong>
                        <span style={{ 
                          marginLeft: '12px',
                          opacity: 0.6,
                          fontFamily: "'Helvetica Neue', sans-serif",
                          fontSize: '0.9rem',
                        }}>
                          → {getPickedFilm(player.pick_id)?.title}
                        </span>
                      </div>
                      <button
                        onClick={() => removePlayer(player.id)}
                        style={{
                          padding: '6px 12px',
                          background: 'rgba(239,68,68,0.2)',
                          border: '1px solid #ef4444',
                          borderRadius: '4px',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontFamily: "'Helvetica Neue', sans-serif",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={resetAll}
                style={{
                  marginTop: '16px',
                  padding: '12px 24px',
                  background: 'rgba(239,68,68,0.2)',
                  border: '1px solid #ef4444',
                  borderRadius: '8px',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontFamily: "'Helvetica Neue', sans-serif",
                }}
              >
                Reset Everything
              </button>
            </div>
            
            {/* Logout Button */}
            <div style={{
              marginTop: '24px',
              textAlign: 'center',
            }}>
              <button
                onClick={handleAdminLogout}
                style={{
                  padding: '12px 24px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '8px',
                  color: 'rgba(255,255,255,0.6)',
                  cursor: 'pointer',
                  fontFamily: "'Helvetica Neue', sans-serif",
                  fontSize: '0.9rem',
                }}
              >
                🔒 Lock Admin & Logout
              </button>
            </div>
            </>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '24px',
        borderTop: '1px solid rgba(255,215,0,0.2)',
        fontFamily: "'Helvetica Neue', sans-serif",
        fontSize: '0.8rem',
        opacity: 0.5,
      }}>
        Points Formula: 100 × (1 - odds) · Harder picks = more points · Real-time sync enabled ⚡
      </footer>
    </div>
  );
}
