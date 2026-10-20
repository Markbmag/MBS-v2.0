SELECT q_customers.name AS name, count(DISTINCT q_products.sku) AS skus 
FROM q_customers JOIN q_orders ON q_customers.id = q_orders.customer_id JOIN q_order_items ON q_orders.id = q_order_items.order_id JOIN q_products ON q_order_items.sku = q_products.sku GROUP BY q_customers.name ORDER BY "name" ASC
 LIMIT 2000 OFFSET 0
