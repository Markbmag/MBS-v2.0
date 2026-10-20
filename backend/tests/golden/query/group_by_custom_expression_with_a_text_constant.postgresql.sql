SELECT coalesce(q_orders.status, 'none') AS state, count(*) AS n 
FROM q_orders GROUP BY coalesce(q_orders.status, 'none') ORDER BY "state" ASC 
 LIMIT 2000
