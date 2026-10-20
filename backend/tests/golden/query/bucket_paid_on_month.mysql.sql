SELECT date_sub(date(q_orders.paid_on), INTERVAL dayofmonth(q_orders.paid_on) - 1 DAY) AS period, count(*) AS n 
FROM q_orders GROUP BY date_sub(date(q_orders.paid_on), INTERVAL dayofmonth(q_orders.paid_on) - 1 DAY) ORDER BY `period` ASC 
 LIMIT 2000
