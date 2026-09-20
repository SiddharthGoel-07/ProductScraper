// client/src/components/SearchBar.jsx
// Controlled search input. The parent owns loading state so it can render the
// slow-first-search hint (searchCatalog walks the whole catalog).

export default function SearchBar({ value, onChange, onSubmit, loading, placeholder = 'Search the store catalog, e.g. "boot"' }) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus
        aria-label="Search query"
      />
      <button type="submit" className="btn-primary sm:w-40" disabled={loading || !value.trim()}>
        {loading ? 'Searching…' : 'Search'}
      </button>
    </form>
  );
}
