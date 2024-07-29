if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      constructor() {
        super();

        this.form = this.querySelector('form');
        this.form.querySelector('[name=id]').disabled = false;
        this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.submitButton = this.querySelector('[type="submit"]');

        if (document.querySelector('cart-drawer')) this.submitButton.setAttribute('aria-haspopup', 'dialog');

        this.hideErrors = this.dataset.hideErrors === 'true';
      }

      onSubmitHandler(evt) {
        evt.preventDefault();
        if (this.submitButton.getAttribute('aria-disabled') === 'true') return;

        this.handleErrorMessage();

        this.submitButton.setAttribute('aria-disabled', true);
        this.submitButton.classList.add('loading');
        this.querySelector('.loading__spinner').classList.remove('hidden');

        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const formData = new FormData(this.form);

        if (this.cart) {
          formData.append(
            'sections',
            this.cart.getSectionsToRender().map((section) => section.id)
          );
          formData.append('sections_url', window.location.pathname);
          this.cart.setActiveElement(document.activeElement);
        }
        config.body = formData;

        const productVariantId = formData.get('id');

        fetch(`${routes.cart_add_url}`, config)
          .then((response) => response.json())
          .then(async (response) => {
            if (response.status) {
              publish(PUB_SUB_EVENTS.cartError, {
                source: 'product-form',
                productVariantId,
                errors: response.errors || response.description,
                message: response.message,
              });

              const errorMessage = this.isProductStockAlreadyEntirelyInCartError(response)
                ? this.replaceErrorMessage(response)
                : response.description;
              this.handleErrorMessage(errorMessage);

              if (this.handleSoldOutMessage()) {
                return;
              }

              this.error = true;
            } else if (!this.cart) {
              window.location = window.routes.cart_url;
              return;
            }

            if (!this.error) {
              // Hide error message if it was previously shown
              this.errorMessageWrapper.toggleAttribute('hidden', true);
            }

            const shouldOpenCartNotification = this.shouldOpenCartNotification(response);
            // When /cart/add.js returns an error, sections are not returned so we need to refetch them.
            // This is useful when you add more quantity than available, which adds to your cart the maximum available quantity.
            // In this case, we still want to have our cart updated.
            const cartResponse = this.error ? await this.refetchSections(productVariantId) : response;

            // Update cart
            publish(PUB_SUB_EVENTS.cartUpdate, {
              source: 'product-form',
              productVariantId,
              cartData: cartResponse,
            });

            const quickAddModal = this.closest('quick-add-modal');
            if (quickAddModal) {
              document.body.addEventListener(
                'modalClosed',
                () => {
                  setTimeout(() => {
                    this.cart.renderContents(cartResponse);
                  });
                },
                { once: true }
              );
              quickAddModal.hide(true);
            } else {
              this.cart.renderContents(cartResponse, shouldOpenCartNotification);
            }
          })
          .catch((e) => {
            console.error(e);
          })
          .finally(() => {
            this.submitButton.classList.remove('loading');
            if (this.cart && this.cart.classList.contains('is-empty')) this.cart.classList.remove('is-empty');
            this.submitButton.removeAttribute('aria-disabled');
            this.querySelector('.loading__spinner').classList.add('hidden');
            this.error = false;
          });
      }

      handleSoldOutMessage() {
        const soldOutMessage = this.submitButton.querySelector('.sold-out-message');

        if (!soldOutMessage) {
          return false;
        }

        this.submitButton.setAttribute('aria-disabled', true);
        this.submitButton.querySelector('span').classList.add('hidden');
        soldOutMessage.classList.remove('hidden');

        return true;
      }

      async refetchSections(variantId) {
        const config = fetchGetConfig('javascript');
        const sections = this.cart
          .getSectionsToRender()
          .map((section) => section.id)
          .join(',');
        const params = new URLSearchParams({ sections });
        const sectionsResponse = await fetch(`/?${params.toString()}`, config).then((response) => response.json());

        // - variantId is returned for the price-per-item component
        // - sections is returned for the cart-notification component
        return { sections: sectionsResponse, variant_id: variantId };
      }

      handleErrorMessage(errorMessage = false) {
        if (this.hideErrors) return;

        this.errorMessageWrapper =
          this.errorMessageWrapper || this.querySelector('.product-form__error-message-wrapper');
        if (!this.errorMessageWrapper) return;
        this.errorMessage = this.errorMessage || this.errorMessageWrapper.querySelector('.product-form__error-message');

        if (errorMessage) {
          this.errorMessageWrapper.toggleAttribute('hidden', false);
          this.errorMessage.textContent = errorMessage;
        }
      }

      replaceErrorMessage(response) {
        const productInfo = this.getProductInfoFromProductStockAlreadyEntirelyInCartError(response);
        const productTitle = productInfo ? `de ${productInfo.title}` : '';

        return `La totalité du stock ${productTitle} est déjà dans votre panier.`;
      }

      // Note: This is very fragile but shopify does not provide better error metadata...
      isProductStockAlreadyEntirelyInCartError(response) {
        return response.status && response.description.includes('ont été ajouté(e)s à votre panier.');
      }

      // Note: This is very fragile but shopify does not provide better error metadata...
      isProductStockNowEntirelyInCartError(response) {
        return response.status && response.description.includes('Vous ne pouvez plus ajouter le produit');
      }

      shouldOpenCartNotification(response) {
        // If there's no error, we open the cart notification
        if (!response.status) {
          return true;
        }

        // If the error is that the stock is already entirely in the cart,
        // there's no need to open the cart notification because no product was added to the cart
        if (this.isProductStockAlreadyEntirelyInCartError(response)) {
          return false;
        }

        // If the error is that the stock is now entirely in the cart, the maximum available quantity was just added to the cart.
        // So we open the cart notification.
        if (this.isProductStockNowEntirelyInCartError(response)) {
          return true;
        }

        // If the error is that the product is sold out, we don't open the cart notification
        return false;
      }

      getProductInfoFromProductStockAlreadyEntirelyInCartError(response) {
        const string = 'Vos 6 ALFALIQUID FR-M - 6mg / 10ml ont été ajouté(e)s à votre panier.';
        const regex = /Vos (\d+) (.+?) ont été ajouté\(e\)s à votre panier\./;
        const match = string.match(regex);

        if (match) {
          const quantity = match[1];
          const title = match[2];

          return { title, quantity };
        } else {
          return null;
        }
      }
    }
  );
}
