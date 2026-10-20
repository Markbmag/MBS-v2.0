SELECT date_sub(date(q_orders.created_at), INTERVAL dayofmonth(q_orders.created_at) - 1 DAY) AS created_at_month, q_customers.region AS region, sum(q_orders.total) AS revenue, count(DISTINCT q_orders.customer_id) AS buyers 
FROM q_orders LEFT OUTER JOIN q_customers ON q_orders.customer_id = q_customers.id 
WHERE q_orders.status = 'paid' GROUP BY date_sub(date(q_orders.created_at), INTERVAL dayofmonth(q_orders.created_at) - 1 DAY), q_customers.region ORDER BY `created_at_month` ASC, `region` ASC 
 LIMIT 2000
