SELECT avg(q_orders.qty) AS a, min(q_orders.created_at) AS first, count(q_orders.qty) AS n 
FROM q_orders 
 LIMIT 2000
