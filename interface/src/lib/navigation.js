export const initialNavigation = { phase: 'overview', target: null };

// target: { id, name, position, viewOffset, frame } — seçilen araç. Akış:
// overview → framing (izin kuş bakışına uçuş) → preview (özet kartı) → DETAILS → diving → focused.
// Geri dönüş aynı adımları ters sırayla izler: focused → closing → backing → preview →
// leaving → returning → overview. Panel/kart kapanışı tamamlanmadan kamera geri hareket etmez.
// Odaktayken başka araca tıklamak doğrudan ona dalar.
export function navigationReducer(state, action) {
  switch (action.type) {
    case 'SELECT':
      if (!action.target) return state;
      if (state.phase === 'overview') return { phase: 'framing', target: action.target };
      if (state.phase === 'preview' && action.target.id !== state.target?.id) return { phase: 'framing', target: action.target };
      if (state.phase === 'focused') return { phase: 'diving', target: action.target };
      return state;
    case 'DETAILS':
      return state.phase === 'preview' ? { ...state, phase: 'diving' } : state;
    case 'ARRIVED':
      if (state.phase === 'framing' || state.phase === 'backing') return { ...state, phase: 'preview' };
      if (state.phase === 'diving') return { ...state, phase: 'focused' };
      if (state.phase === 'returning') return initialNavigation;
      return state;
    case 'RESET':
      if (state.phase === 'focused') return { ...state, phase: 'closing' };
      if (state.phase === 'diving') return { ...state, phase: 'backing' };
      if (state.phase === 'preview') return { ...state, phase: 'leaving' };
      if (state.phase === 'framing') return { ...state, phase: 'returning' };
      return state;
    case 'PANEL_CLOSED':
      return state.phase === 'closing' ? { ...state, phase: 'backing' } : state;
    case 'CARD_CLOSED':
      return state.phase === 'leaving' ? { ...state, phase: 'returning' } : state;
    default:
      return state;
  }
}
