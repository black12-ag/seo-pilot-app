// Runs before the page paints, so content that animates in starts hidden only
// when JavaScript is on. Without JavaScript everything stays visible.
document.documentElement.classList.add("js");
