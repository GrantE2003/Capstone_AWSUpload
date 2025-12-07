//Handle search bar submission
//Store last search in localStorage
//Redirect to search results page with query parameter
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('searchform');
    const input = document.getElementById('searchInput');

    if (!form || !input) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return;

        localStorage.setItem('app:lastSearch', q);

        window.location.href = `/Pages/search_results.html?q=${encodeURIComponent(q)}`;
    });
});

//Display search term on search results page
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(location.search);
    const q = params.get('q') || localStorage.getItem('app:lastSearch') || '';
                    
    const h = document.getElementById('searchTitle');
    
    if (h) {
        h.textContent = q ? `Your Search for Summarization: "${q}"` : 'No Results Available.';
    }

    console.log('search term:', q);
});