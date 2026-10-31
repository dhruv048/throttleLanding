// Light only for now: the dark mode toggle is hidden, so a dark choice saved
// earlier is ignored (otherwise those visitors would be stuck in dark mode).
// To bring dark mode back, unhide #themeToggle and restore the saved-theme read.
(function () {
  document.documentElement.setAttribute("data-theme", "light");
})();
