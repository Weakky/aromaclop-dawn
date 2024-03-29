async function buy_order(ids, quantities, buttonId) {
  var submitButton = document.getElementById(buttonId);

  submitButton.classList.add("loading");
  submitButton.setAttribute('aria-disabled', true);
  submitButton.setAttribute('disabled', true);

  submitButton.querySelector('.loading-overlay__spinner').classList.remove('hidden');

  var itemsPayload = ids.map((id, i) => ({ id, quantity: quantities[i] }));
  var payload = { items: itemsPayload };

  // Clear cart
  await fetch("/cart/clear.js", { method: "POST" });
  // Add order items to cart
  await fetch("/cart/add.js", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  // Redirect to cart page
  window.location.href = "/cart";
}
